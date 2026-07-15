import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FFmpegComposeExecutor } from '../compose.executor';
import type { RenderTimelinePayload } from '@project/shared';

/**
 * Bounded multi-pass render (Tier 2): above RENDER_MAX_INPUTS_PER_PASS total
 * inputs, the executor renders sequential video-only windows, one
 * full-timeline audio pass, and a lossless concat — so no single ffmpeg run
 * opens more decoders than the cap allows.
 *
 * Fixture timeline (6s total, 4 inputs: 3 video + 1 audio):
 *   video: [0–2], [2–3.5], [4–6]   (gap 3.5–4 exercises window padding)
 *   audio: [0–6]
 *   text:  [0–6] caption
 * With the cap stubbed to 2, the planner cuts at 4s (3 videos would overlap
 * a [0,6) window): part-000 = [0,4) with 2 inputs, part-001 = [4,6) with 1.
 */
function makeFixture() {
  const tracks: RenderTimelinePayload['tracks'] = [
    {
      id: 'video',
      type: 'video',
      layer: 0,
      segments: [
        {
          id: 'v-seg1',
          assetId: 'v1',
          type: 'video',
          time: { start: 0, duration: 2, sourceStart: 0 },
        },
        {
          id: 'v-seg2',
          assetId: 'v2',
          type: 'video',
          time: { start: 2, duration: 1.5, sourceStart: 10 },
        },
        {
          id: 'v-seg3',
          assetId: 'v3',
          type: 'video',
          time: { start: 4, duration: 2, sourceStart: 0 },
        },
      ],
    },
    {
      id: 'audio',
      type: 'audio',
      layer: 1,
      segments: [
        {
          id: 'a-seg1',
          assetId: 'a1',
          type: 'audio',
          time: { start: 0, duration: 6, sourceStart: 0 },
        },
      ],
    },
    {
      id: 'captions',
      type: 'text',
      layer: 2,
      segments: [
        {
          id: 't-seg1',
          type: 'text',
          time: { start: 0, duration: 6 },
          text: { content: 'Lower Third', fontSize: 48, position: 'bottom' },
        },
      ],
    },
  ];

  const clipMediaMap = {
    v1: { media: { id: 'v1' } as never, filePath: '/tmp/v1.mp4' },
    v2: { media: { id: 'v2' } as never, filePath: '/tmp/v2.mp4' },
    v3: { media: { id: 'v3' } as never, filePath: '/tmp/v3.mp4' },
    a1: {
      media: { id: 'a1', mediaData: { audio: true } } as never,
      filePath: '/tmp/a1.mp4',
    },
  };

  const outputSettings: RenderTimelinePayload['outputSettings'] = {
    codec: 'libx264',
    format: 'mp4',
    resolution: '1920x1080',
  };

  return { tracks, clipMediaMap, outputSettings };
}

function makeFFmpegServiceMock() {
  const calls: string[][] = [];
  const progressValues: number[] = [];
  const ffmpegService = {
    executeWithProgress: vi
      .fn()
      .mockImplementation(
        (args: string[], onProgress?: (p: number) => void) => {
          calls.push(args);
          onProgress?.(50);
          onProgress?.(100);
          return Promise.resolve();
        }
      ),
    probe: vi.fn().mockResolvedValue({
      streams: [
        {
          codec_type: 'video',
          codec_name: 'h264',
          width: 1920,
          height: 1080,
          r_frame_rate: '30/1',
        },
      ],
      format: {
        duration: '6',
        bit_rate: '1000',
        size: '1000',
        format_name: 'mp4',
      },
    }),
  };
  return { ffmpegService, calls, progressValues };
}

const filterOf = (args: string[]) => args[args.indexOf('-filter_complex') + 1];
const inputCountOf = (args: string[]) => args.filter((a) => a === '-i').length;

describe('FFmpegComposeExecutor bounded multi-pass', () => {
  let scratchDir: string;
  let outputPath: string;

  beforeEach(() => {
    scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multipass-'));
    outputPath = path.join(scratchDir, 'output.mp4');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(scratchDir, { recursive: true, force: true });
  });

  it('renders windows, audio, and concat with bounded inputs per pass', async () => {
    vi.stubEnv('RENDER_MAX_INPUTS_PER_PASS', '2');
    const { tracks, clipMediaMap, outputSettings } = makeFixture();
    const { ffmpegService, calls } = makeFFmpegServiceMock();
    const progressValues: number[] = [];
    const executor = new FFmpegComposeExecutor(ffmpegService as never);

    const result = await executor.execute(
      tracks,
      clipMediaMap,
      outputPath,
      outputSettings,
      (p) => progressValues.push(p)
    );

    // 2 window passes + 1 audio pass + 1 concat pass
    expect(calls.length).toBe(4);
    const [part0, part1, audio, concat] = calls;
    const partsDir = path.join(scratchDir, 'parts');

    // Window passes: video-only, bounded inputs, shared part timescale
    for (const part of [part0, part1]) {
      expect(inputCountOf(part)).toBeLessThanOrEqual(2);
      expect(part).toContain('-video_track_timescale');
      expect(part).toContain('15360');
      expect(part).not.toContain('-c:a');
      expect(part).not.toContain('[outa]');
    }
    expect(part0[part0.length - 1]).toBe(path.join(partsDir, 'part-000.mp4'));
    expect(part1[part1.length - 1]).toBe(path.join(partsDir, 'part-001.mp4'));
    expect(inputCountOf(part0)).toBe(2); // [0–2] + [2–3.5]
    expect(inputCountOf(part1)).toBe(1); // [4–6]

    // Part 0 pads its canvas to the planned window end (4s), not to its
    // content end (3.5s) — a short part would desync everything at concat.
    expect(filterOf(part0)).toContain('d=4[base]');
    expect(filterOf(part1)).toContain('d=2[base]');

    // The caption renders in every window it overlaps (shifted, not clipped)
    expect(filterOf(part0)).toContain('drawtext');
    expect(filterOf(part1)).toContain('drawtext');

    // Audio pass: whole-timeline audio graph, no video encode
    expect(audio[audio.length - 1]).toBe(path.join(partsDir, 'audio.m4a'));
    expect(audio).toContain('-map');
    expect(audio).toContain('[outa]');
    expect(audio).not.toContain('-c:v');
    expect(audio).toContain('-c:a');
    expect(filterOf(audio)).toContain('amix');
    expect(filterOf(audio)).not.toContain('color=c=black');

    // Concat pass: lossless stream copy of parts + audio
    const listPath = path.join(partsDir, 'list.txt');
    expect(concat).toEqual([
      '-y',
      '-nostdin',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      listPath,
      '-i',
      path.join(partsDir, 'audio.m4a'),
      '-map',
      '0:v',
      '-map',
      '1:a',
      '-c',
      'copy',
      '-f',
      'mp4',
      outputPath,
    ]);
    expect(fs.readFileSync(listPath, 'utf8')).toBe(
      `file '${path.join(partsDir, 'part-000.mp4')}'\n` +
        `file '${path.join(partsDir, 'part-001.mp4')}'\n`
    );

    // Progress is monotonic and completes
    for (let i = 1; i < progressValues.length; i++) {
      expect(progressValues[i]).toBeGreaterThanOrEqual(progressValues[i - 1]);
    }
    expect(progressValues[progressValues.length - 1]).toBe(100);

    // The final output is probed, as in single-pass mode
    expect(ffmpegService.probe).toHaveBeenCalledWith(outputPath);
    expect(result.outputPath).toBe(outputPath);
  });

  it('keeps the single-pass path when inputs fit under the default cap', async () => {
    const { tracks, clipMediaMap, outputSettings } = makeFixture();
    const { ffmpegService, calls } = makeFFmpegServiceMock();
    const executor = new FFmpegComposeExecutor(ffmpegService as never);

    await executor.execute(tracks, clipMediaMap, outputPath, outputSettings);

    // 4 inputs ≤ default cap (24) → exactly one full-mode run
    expect(calls.length).toBe(1);
    const [args] = calls;
    expect(args[args.length - 1]).toBe(outputPath);
    expect(inputCountOf(args)).toBe(4);
    expect(args).toContain('-c:v');
    expect(args).toContain('-c:a');
    expect(args).not.toContain('-video_track_timescale');
    expect(args).toContain('[outa]');
  });
});
