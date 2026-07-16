import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FFmpegComposeExecutor } from './compose.executor';
import { FFmpegService } from '../../../shared/services/ffmpeg.service';
import {
  TimelineOrientation,
  generateTracks,
  type TimelineClip,
  type TimelineTrack,
  type TimelineTrackRecord,
} from '@project/shared';

describe('FFmpegComposeExecutor', () => {
  let executor: FFmpegComposeExecutor;
  let ffmpegService: FFmpegService;

  beforeEach(async () => {
    // Manually create mock object
    const mockFFmpegService = {
      executeWithProgress: vi.fn(),
      probe: vi.fn().mockResolvedValue({
        format: {
          duration: '10.0',
          bit_rate: '1000',
          size: '1000',
          format_name: 'mp4',
        },
        streams: [
          {
            codec_type: 'video',
            width: 1920,
            height: 1080,
            codec_name: 'h264',
            r_frame_rate: '30/1',
          },
        ],
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FFmpegComposeExecutor,
        {
          provide: FFmpegService,
          useValue: mockFFmpegService,
        },
      ],
    }).compile();

    executor = module.get<FFmpegComposeExecutor>(FFmpegComposeExecutor);
    ffmpegService = module.get<FFmpegService>(FFmpegService);
  });

  it('should be defined', () => {
    expect(executor).toBeDefined();
    expect(ffmpegService).toBeDefined();
    // Check if service is injected
    // With private property, we can't check directly easily in TS without casting, but the fact that execute throws suggests it is undefined.
    // But module.get returns the instance which should have dependencies injected.
    // The issue is likely that 'private readonly' property is not being populated?
    // This is standard NestJS.
    // Maybe the mock needs to be a class instance?
  });

  it('should build correct FFmpeg command for single video track', async () => {
    const tracks: TimelineTrack[] = [
      {
        id: 'track1',
        type: 'video',
        layer: 0,
        segments: [
          {
            id: 'seg1',
            assetId: 'asset1',
            type: 'video',
            time: { start: 0, duration: 5, sourceStart: 0 },
          },
          {
            id: 'seg2',
            assetId: 'asset2',
            type: 'video',
            time: { start: 5, duration: 5, sourceStart: 0 },
          },
        ],
      },
    ];

    const clipMediaMap = {
      asset1: { media: { id: 'asset1' }, filePath: '/tmp/1.mp4' } as any,
      asset2: { media: { id: 'asset2' }, filePath: '/tmp/2.mp4' } as any,
    };

    const outputSettings = {
      codec: 'libx264',
      format: 'mp4',
      resolution: '1920x1080',
    };

    await executor.execute(
      tracks,
      clipMediaMap,
      '/tmp/output.mp4',
      outputSettings
    );

    const executeSpy = vi.spyOn(ffmpegService, 'executeWithProgress');
    const args = executeSpy.mock.calls[0][0] as string[];

    // Verify inputs
    expect(args).toContain('/tmp/1.mp4');
    expect(args).toContain('/tmp/2.mp4');

    // Verify filter complex
    const filterComplexIndex = args.indexOf('-filter_complex');
    expect(filterComplexIndex).toBeGreaterThan(-1);
    const filterComplex = args[filterComplexIndex + 1];

    expect(filterComplex).toContain('color=c=black');
    // Enable windows sit on half-frame offsets: at 30fps the [0,5)+[5,10)
    // cut becomes [0,149.5/30)+[149.5/30,299.5/30), so every output frame
    // belongs to exactly one side of the cut (frame-exactness contract).
    expect(filterComplex).toContain(
      "overlay=x=0:y=0:enable='between(t,0,4.983333)'"
    );
    expect(filterComplex).toContain(
      "overlay=x=0:y=0:enable='between(t,4.983333,9.983333)'"
    );
  });

  it('applies stability flags: seeked inputs, slow preset, no -s, threads left to ffmpeg', async () => {
    const tracks: TimelineTrack[] = [
      {
        id: 'track1',
        type: 'video',
        layer: 0,
        segments: [
          {
            id: 'seg1',
            assetId: 'asset1',
            type: 'video',
            time: { start: 0, duration: 5, sourceStart: 2 },
          },
        ],
      },
    ];

    const clipMediaMap = {
      asset1: { media: { id: 'asset1' }, filePath: '/tmp/1.mp4' } as any,
    };

    const executeSpy = vi.spyOn(ffmpegService, 'executeWithProgress');
    await executor.execute(tracks, clipMediaMap, '/tmp/output.mp4', {
      codec: 'libx264',
      format: 'mp4',
      resolution: '1920x1080',
    });

    const args = executeSpy.mock.calls[0][0] as string[];
    const joined = args.join(' ');
    const filterComplex = args[args.indexOf('-filter_complex') + 1];

    // Never waits on stdin under a job runner
    expect(args).toContain('-nostdin');
    // Threading is left to ffmpeg's auto-sizing — no explicit caps
    expect(args).not.toContain('-threads');
    expect(args).not.toContain('-filter_complex_threads');
    // Input-level seeking bounds decode to the segment window
    expect(joined).toContain('-ss 2 -t 5 -i /tmp/1.mp4');
    // Encoder preset lowered from veryslow (RAM) to slow
    expect(joined).toContain('-preset slow');
    expect(joined).not.toContain('veryslow');
    // Redundant output scaler removed
    expect(args).not.toContain('-s');
    // Segment branches and the base canvas share one CFR grid
    expect(filterComplex).toContain('fps=30');
    expect(filterComplex).toContain(':r=30:');
    // Known timeline duration is passed for progress/stall tracking
    expect(executeSpy.mock.calls[0][2]).toBe(5);
  });

  it('should handle PIP overlay', async () => {
    const tracks: TimelineTrack[] = [
      {
        id: 'track1',
        type: 'video',
        layer: 0,
        segments: [
          {
            id: 'seg1',
            assetId: 'asset1',
            type: 'video',
            time: { start: 0, duration: 10, sourceStart: 0 },
          },
        ],
      },
      {
        id: 'track2',
        type: 'video',
        layer: 1,
        segments: [
          {
            id: 'seg2',
            assetId: 'asset2',
            type: 'video',
            time: { start: 2, duration: 5, sourceStart: 0 },
            video: { x: 100, y: 100, width: 320, height: 180 },
          },
        ],
      },
    ];

    const clipMediaMap = {
      asset1: { media: { id: 'asset1' }, filePath: '/tmp/bg.mp4' } as any,
      asset2: { media: { id: 'asset2' }, filePath: '/tmp/pip.mp4' } as any,
    };

    const outputSettings = {
      codec: 'libx264',
      format: 'mp4',
      resolution: '1920x1080',
    };

    await executor.execute(
      tracks,
      clipMediaMap,
      '/tmp/output.mp4',
      outputSettings
    );

    const executeSpy = vi.spyOn(ffmpegService, 'executeWithProgress');
    const args = executeSpy.mock.calls[0][0] as string[];
    const filterComplex = args[args.indexOf('-filter_complex') + 1];

    // Check for PIP scaling and overlay ([2,7) → half-frame offsets at 30fps)
    expect(filterComplex).toContain('scale=320:180');
    expect(filterComplex).toContain('overlay=x=100:y=100');
    expect(filterComplex).toContain("enable='between(t,1.983333,6.983333)'");
  });

  it('should handle text overlay', async () => {
    const tracks: TimelineTrack[] = [
      {
        id: 'track1',
        type: 'video',
        layer: 0,
        segments: [
          {
            id: 'seg1',
            assetId: 'asset1',
            type: 'video',
            time: { start: 0, duration: 5, sourceStart: 0 },
          },
        ],
      },
      {
        id: 'track2',
        type: 'text',
        layer: 1,
        segments: [
          {
            id: 'txt1',
            type: 'text',
            time: { start: 1, duration: 2, sourceStart: 0 },
            text: {
              content: 'Hello World',
              fontSize: 50,
              color: '#FFFFFF',
              x: 10,
              y: 10,
            },
          },
        ],
      },
    ];

    const clipMediaMap = {
      asset1: { media: { id: 'asset1' }, filePath: '/tmp/bg.mp4' } as any,
    };

    const outputSettings = {
      codec: 'libx264',
      format: 'mp4',
      resolution: '1920x1080',
    };

    await executor.execute(
      tracks,
      clipMediaMap,
      '/tmp/output.mp4',
      outputSettings
    );

    const executeSpy = vi.spyOn(ffmpegService, 'executeWithProgress');
    const args = executeSpy.mock.calls[0][0] as string[];
    const filterComplex = args[args.indexOf('-filter_complex') + 1];

    expect(filterComplex).toContain(
      "drawtext=expansion=none:text='Hello World'"
    );
    expect(filterComplex).toContain('fontsize=50');
    // Color might be converted
    expect(filterComplex).toContain('fontcolor=0xFFFFFFFF'); // #FFFFFF -> 0xFFFFFFFF
    expect(filterComplex).toContain("enable='between(t,1,3)'");
    // No box set -> outline + shadow applied by default for legibility
    expect(filterComplex).toContain('bordercolor=0x000000E6'); // black @ 0.9
    expect(filterComplex).toContain('shadowcolor=0x00000080'); // black @ 0.5
    expect(filterComplex).toMatch(/shadowx=\d+:shadowy=\d+/);
  });

  it('splits multi-line caption text into one centered drawtext per line', async () => {
    const tracks: TimelineTrack[] = [
      {
        id: 'track1',
        type: 'text',
        layer: 0,
        segments: [
          {
            id: 'txt1',
            type: 'text',
            time: { start: 0, duration: 2, sourceStart: 0 },
            text: {
              content: 'John Smith\nNew Beginnings',
              role: 'title',
              fontSize: 40,
              position: 'middle',
              align: 'center',
            },
          },
        ],
      },
    ];

    const executeSpy = vi.spyOn(ffmpegService, 'executeWithProgress');
    await executor.execute(tracks, {}, '/tmp/output.mp4', {
      codec: 'libx264',
      format: 'mp4',
      resolution: '1920x1080',
    });

    const args = executeSpy.mock.calls[0][0] as string[];
    const filterComplex = args[args.indexOf('-filter_complex') + 1];

    // Never hand a raw CR/LF to drawtext — those render as .notdef "tofu" boxes.
    expect(filterComplex).not.toMatch(/[\r\n]/);
    // One drawtext per line, each carrying only its own line's text.
    expect(filterComplex).toContain("text='John Smith'");
    expect(filterComplex).toContain("text='New Beginnings'");
    // Each line self-centers via the text_w-based x expression.
    const centeredLines = filterComplex
      .split(';')
      .filter((f) => f.includes('drawtext=') && f.includes('x=(w-text_w)/2'));
    expect(centeredLines).toHaveLength(2);
    // Lines stack a line-height apart (round(40 * 1.375) = 55), block-centered.
    expect(filterComplex).toContain('y=(h-110)/2+0');
    expect(filterComplex).toContain('y=(h-110)/2+55');
    // Per-line output labels stay unique.
    expect(filterComplex).toContain('[v_txt_txt1_0_0]');
    expect(filterComplex).toContain('[v_txt_txt1_0_1]');
  });

  it('strips CR from CRLF line endings so no tofu box is drawn', async () => {
    const tracks: TimelineTrack[] = [
      {
        id: 'track1',
        type: 'text',
        layer: 0,
        segments: [
          {
            id: 'txt1',
            type: 'text',
            time: { start: 0, duration: 2, sourceStart: 0 },
            text: { content: 'John Smith\r\nNew Beginnings', fontSize: 40 },
          },
        ],
      },
    ];

    const executeSpy = vi.spyOn(ffmpegService, 'executeWithProgress');
    await executor.execute(tracks, {}, '/tmp/output.mp4', {
      codec: 'libx264',
      format: 'mp4',
      resolution: '1920x1080',
    });

    const args = executeSpy.mock.calls[0][0] as string[];
    const filterComplex = args[args.indexOf('-filter_complex') + 1];

    // CRLF must not leak a bare CR (or the "rn" it degrades to) into the text.
    expect(filterComplex).not.toMatch(/[\r\n]/);
    expect(filterComplex).toContain("text='John Smith'");
    expect(filterComplex).toContain("text='New Beginnings'");
    expect(filterComplex).not.toContain("text='John Smith\rNew Beginnings'");
  });

  it('should use the configured font file when RENDER_FONT_FILE is set', async () => {
    vi.stubEnv('RENDER_FONT_FILE', '/opt/fonts/regular.ttf');
    vi.stubEnv('RENDER_FONT_FILE_BOLD', '/opt/fonts/bold.ttf');

    const tracks: TimelineTrack[] = [
      {
        id: 'track1',
        type: 'text',
        layer: 0,
        segments: [
          {
            id: 'txt1',
            type: 'text',
            time: { start: 0, duration: 2, sourceStart: 0 },
            text: { content: 'Title', fontSize: 96, bold: true },
          },
        ],
      },
    ];

    const executeSpy = vi.spyOn(ffmpegService, 'executeWithProgress');
    await executor.execute(tracks, {}, '/tmp/output.mp4', {
      codec: 'libx264',
      format: 'mp4',
      resolution: '1920x1080',
    });

    const args = executeSpy.mock.calls[0][0] as string[];
    const filterComplex = args[args.indexOf('-filter_complex') + 1];

    // Bold text picks the bold font file
    expect(filterComplex).toContain("fontfile='/opt/fonts/bold.ttf'");
    vi.unstubAllEnvs();
  });

  it('should skip the outline when a background box is set', async () => {
    const tracks: TimelineTrack[] = [
      {
        id: 'track1',
        type: 'text',
        layer: 0,
        segments: [
          {
            id: 'txt1',
            type: 'text',
            time: { start: 0, duration: 2, sourceStart: 0 },
            text: {
              content: 'Subtitle',
              fontSize: 48,
              backgroundColor: '#000000',
            },
          },
        ],
      },
    ];

    const executeSpy = vi.spyOn(ffmpegService, 'executeWithProgress');
    await executor.execute(tracks, {}, '/tmp/output.mp4', {
      codec: 'libx264',
      format: 'mp4',
      resolution: '1920x1080',
    });

    const args = executeSpy.mock.calls[0][0] as string[];
    const filterComplex = args[args.indexOf('-filter_complex') + 1];

    // Box present -> no outline, but shadow still applied
    expect(filterComplex).toContain('box=1');
    expect(filterComplex).not.toContain('bordercolor=');
    expect(filterComplex).toContain('shadowcolor=');
  });

  describe('text gating by role', () => {
    // A title/caption clip and an auto-subtitle segment on the same chain.
    const gatingTracks: TimelineTrack[] = [
      {
        id: 'track1',
        type: 'text',
        layer: 0,
        segments: [
          {
            id: 'title1',
            type: 'text',
            time: { start: 0, duration: 2, sourceStart: 0 },
            text: { content: 'A Title', role: 'title', fontSize: 96 },
          },
          {
            id: 'sub1',
            type: 'text',
            time: { start: 0, duration: 2, sourceStart: 0 },
            text: { content: 'A Subtitle', role: 'subtitle', fontSize: 48 },
          },
        ],
      },
    ];

    const runWith = async (
      outputSettings: Record<string, unknown>
    ): Promise<string> => {
      const executeSpy = vi.spyOn(ffmpegService, 'executeWithProgress');
      await executor.execute(gatingTracks, {}, '/tmp/output.mp4', {
        codec: 'libx264',
        format: 'mp4',
        resolution: '1920x1080',
        ...outputSettings,
      } as never);
      const args = executeSpy.mock.calls[0][0] as string[];
      return args[args.indexOf('-filter_complex') + 1];
    };

    it('draws captions but not subtitles by default (subtitles off, captions on)', async () => {
      const fc = await runWith({});
      expect(fc).toContain("drawtext=expansion=none:text='A Title'");
      expect(fc).not.toContain("drawtext=expansion=none:text='A Subtitle'");
    });

    it('draws subtitles only when includeSubtitles is true', async () => {
      const fc = await runWith({ includeSubtitles: true });
      expect(fc).toContain("drawtext=expansion=none:text='A Subtitle'");
      expect(fc).toContain("drawtext=expansion=none:text='A Title'");
    });

    it('gates captions and subtitles independently (captions off, subtitles on)', async () => {
      const fc = await runWith({
        includeCaptions: false,
        includeSubtitles: true,
      });
      expect(fc).not.toContain("drawtext=expansion=none:text='A Title'");
      expect(fc).toContain("drawtext=expansion=none:text='A Subtitle'");
    });
  });

  it('should build correct FFmpeg command for composite clip (multiple segments from same source)', async () => {
    // Simulates expanded composite clip: 4 segments stitched from same media
    // Segments: 1.8-8.7 (6.9s), 12.3-13.5 (1.2s), 14.8-23.1 (8.3s), 28.9-31.1 (2.2s)
    const tracks: TimelineTrack[] = [
      {
        id: 'track1',
        type: 'video',
        layer: 0,
        segments: [
          {
            id: 'seg_0',
            assetId: 'media1',
            type: 'video',
            time: {
              start: 0,
              duration: 6.9,
              sourceStart: 1.8,
            },
          },
          {
            id: 'seg_1',
            assetId: 'media1',
            type: 'video',
            time: {
              start: 6.9,
              duration: 1.2,
              sourceStart: 12.3,
            },
          },
          {
            id: 'seg_2',
            assetId: 'media1',
            type: 'video',
            time: {
              start: 8.1,
              duration: 8.3,
              sourceStart: 14.8,
            },
          },
          {
            id: 'seg_3',
            assetId: 'media1',
            type: 'video',
            time: {
              start: 16.4,
              duration: 2.2,
              sourceStart: 28.9,
            },
          },
        ],
      },
    ];

    const clipMediaMap = {
      media1: { media: { id: 'media1' }, filePath: '/tmp/source.mp4' } as any,
    };

    const outputSettings = {
      codec: 'libx264',
      format: 'mp4',
      resolution: '1920x1080',
    };

    await executor.execute(
      tracks,
      clipMediaMap,
      '/tmp/output.mp4',
      outputSettings
    );

    const executeSpy = vi.spyOn(ffmpegService, 'executeWithProgress');
    const args = executeSpy.mock.calls[0][0] as string[];
    const filterComplex = args[args.indexOf('-filter_complex') + 1];
    const joined = args.join(' ');

    // Each segment gets its own seeked input (-ss/-t before -i) so only the
    // segment window is ever decoded
    expect(joined).toContain('-ss 1.8 -t 6.9 -i /tmp/source.mp4');
    expect(joined).toContain('-ss 12.3 -t 1.2 -i /tmp/source.mp4');
    expect(joined).toContain('-ss 14.8 -t 8.3 -i /tmp/source.mp4');
    expect(joined).toContain('-ss 28.9 -t 2.2 -i /tmp/source.mp4');

    // Verify setpts uses correct timeline start for each segment
    expect(filterComplex).toContain('PTS-STARTPTS+0/TB');
    expect(filterComplex).toContain('PTS-STARTPTS+6.9/TB');
    expect(filterComplex).toContain('PTS-STARTPTS+8.1/TB');
    expect(filterComplex).toContain('PTS-STARTPTS+16.4/TB');

    // Verify overlay enable windows match timeline positions (half-frame
    // offsets at 30fps; consecutive windows share the exact boundary string,
    // so no output frame is left uncovered at a cut)
    expect(filterComplex).toContain("enable='between(t,0,6.883333)'");
    expect(filterComplex).toContain("enable='between(t,6.883333,8.083333)'");
    expect(filterComplex).toContain("enable='between(t,8.083333,16.383333)'");
    expect(filterComplex).toContain("enable='between(t,16.383333,18.583333)'");

    // Verify base duration covers total (18.6s)
    expect(filterComplex).toContain('d=18.6');
  });

  it('should handle composite clip with non-zero timeline start', async () => {
    // Composite clip placed at 10s on timeline (e.g., after another clip)
    const tracks: TimelineTrack[] = [
      {
        id: 'track1',
        type: 'video',
        layer: 0,
        segments: [
          {
            id: 'seg_0',
            assetId: 'media1',
            type: 'video',
            time: {
              start: 10,
              duration: 3.3,
              sourceStart: 1.8,
            },
          },
          {
            id: 'seg_1',
            assetId: 'media1',
            type: 'video',
            time: {
              start: 13.3,
              duration: 1.2,
              sourceStart: 12.3,
            },
          },
        ],
      },
    ];

    const clipMediaMap = {
      media1: { media: { id: 'media1' }, filePath: '/tmp/source.mp4' } as any,
    };

    const executeSpy = vi.spyOn(ffmpegService, 'executeWithProgress');
    await executor.execute(tracks, clipMediaMap, '/tmp/output.mp4', {
      codec: 'libx264',
      format: 'mp4',
      resolution: '1920x1080',
    });

    const args = executeSpy.mock.calls[0][0] as string[];
    const filterComplex = args[args.indexOf('-filter_complex') + 1];
    const joined = args.join(' ');

    expect(joined).toContain('-ss 1.8 -t 3.3 -i /tmp/source.mp4');
    expect(joined).toContain('-ss 12.3 -t 1.2 -i /tmp/source.mp4');
    expect(filterComplex).toContain("enable='between(t,9.983333,13.283333)'");
    expect(filterComplex).toContain("enable='between(t,13.283333,14.483333)'");
    expect(filterComplex).toContain('PTS-STARTPTS+10/TB');
    expect(filterComplex).toContain('PTS-STARTPTS+13.3/TB');
    expect(filterComplex).toContain('d=14.5');
  });

  it('should handle composite clip with single segment', async () => {
    const tracks: TimelineTrack[] = [
      {
        id: 'track1',
        type: 'video',
        layer: 0,
        segments: [
          {
            id: 'seg_0',
            assetId: 'media1',
            type: 'video',
            time: {
              start: 0,
              duration: 4.5,
              sourceStart: 2.1,
            },
          },
        ],
      },
    ];

    const clipMediaMap = {
      media1: { media: { id: 'media1' }, filePath: '/tmp/source.mp4' } as any,
    };

    const executeSpy = vi.spyOn(ffmpegService, 'executeWithProgress');
    await executor.execute(tracks, clipMediaMap, '/tmp/output.mp4', {
      codec: 'libx264',
      format: 'mp4',
      resolution: '1920x1080',
    });

    const args = executeSpy.mock.calls[0][0] as string[];
    const filterComplex = args[args.indexOf('-filter_complex') + 1];

    expect(args.join(' ')).toContain('-ss 2.1 -t 4.5 -i /tmp/source.mp4');
    expect(filterComplex).toContain("enable='between(t,0,4.483333)'");
    expect(filterComplex).toContain('d=4.5');
  });

  it('should handle mixed composite and regular clips on same track', async () => {
    // Regular clip 0-5, then composite (2 segments) 5-12
    const tracks: TimelineTrack[] = [
      {
        id: 'track1',
        type: 'video',
        layer: 0,
        segments: [
          {
            id: 'regular',
            assetId: 'media1',
            type: 'video',
            time: { start: 0, duration: 5, sourceStart: 0 },
          },
          {
            id: 'comp_0',
            assetId: 'media2',
            type: 'video',
            time: {
              start: 5,
              duration: 4,
              sourceStart: 1.8,
            },
          },
          {
            id: 'comp_1',
            assetId: 'media2',
            type: 'video',
            time: {
              start: 9,
              duration: 3,
              sourceStart: 12.3,
            },
          },
        ],
      },
    ];

    const clipMediaMap = {
      media1: { media: { id: 'media1' }, filePath: '/tmp/a.mp4' } as any,
      media2: { media: { id: 'media2' }, filePath: '/tmp/b.mp4' } as any,
    };

    const executeSpy = vi.spyOn(ffmpegService, 'executeWithProgress');
    await executor.execute(tracks, clipMediaMap, '/tmp/output.mp4', {
      codec: 'libx264',
      format: 'mp4',
      resolution: '1920x1080',
    });

    const args = executeSpy.mock.calls[0][0] as string[];
    const filterComplex = args[args.indexOf('-filter_complex') + 1];

    expect(filterComplex).toContain("enable='between(t,0,4.983333)'");
    expect(filterComplex).toContain("enable='between(t,4.983333,8.983333)'");
    expect(filterComplex).toContain("enable='between(t,8.983333,11.983333)'");
    const joined = args.join(' ');
    // sourceStart 0 → no -ss, just -t
    expect(joined).toContain('-t 5 -i /tmp/a.mp4');
    expect(joined).toContain('-ss 1.8 -t 4 -i /tmp/b.mp4');
    expect(joined).toContain('-ss 12.3 -t 3 -i /tmp/b.mp4');
  });

  it('should produce clean decimal values (no floating-point artifacts)', async () => {
    // Values that often cause JS float issues: 0.1 + 0.2, or 6.9 + 1.2 + 8.3 + 2.2
    const tracks: TimelineTrack[] = [
      {
        id: 'track1',
        type: 'video',
        layer: 0,
        segments: [
          {
            id: 'seg_0',
            assetId: 'm1',
            type: 'video',
            time: { start: 0, duration: 0.3, sourceStart: 0.1 },
          },
          {
            id: 'seg_1',
            assetId: 'm1',
            type: 'video',
            time: { start: 0.3, duration: 0.3, sourceStart: 0.5 },
          },
          {
            id: 'seg_2',
            assetId: 'm1',
            type: 'video',
            time: { start: 0.6, duration: 0.3, sourceStart: 0.8 },
          },
        ],
      },
    ];

    const clipMediaMap = {
      m1: { media: { id: 'm1' }, filePath: '/tmp/source.mp4' } as any,
    };

    const executeSpy = vi.spyOn(ffmpegService, 'executeWithProgress');
    await executor.execute(tracks, clipMediaMap, '/tmp/output.mp4', {
      codec: 'libx264',
      format: 'mp4',
      resolution: '1920x1080',
    });

    const args = executeSpy.mock.calls[0][0] as string[];
    const filterComplex = args[args.indexOf('-filter_complex') + 1];

    // Should NOT contain floating-point artifacts like 0.8999999999999999 or 0.6000000000000001
    expect(filterComplex).not.toMatch(/18\.59+9/);
    expect(filterComplex).not.toMatch(/0\.89+9/);
    expect(filterComplex).not.toMatch(/0\.60+0+1/);
    // Should have clean rounded values
    expect(filterComplex).toContain('d=0.9');
    expect(filterComplex).toContain("enable='between(t,0.583333,0.883333)'");
  });

  it('should handle audio segments from composite clip (same source, multiple segments)', async () => {
    const tracks: TimelineTrack[] = [
      {
        id: 'video',
        type: 'video',
        layer: 0,
        segments: [
          {
            id: 'v1',
            assetId: 'media1',
            type: 'video',
            time: { start: 0, duration: 3, sourceStart: 1 },
          },
          {
            id: 'v2',
            assetId: 'media1',
            type: 'video',
            time: { start: 3, duration: 2, sourceStart: 10 },
          },
        ],
      },
      {
        id: 'audio',
        type: 'audio',
        layer: 0,
        segments: [
          {
            id: 'a1',
            assetId: 'media1',
            type: 'audio',
            time: { start: 0, duration: 3, sourceStart: 1 },
          },
          {
            id: 'a2',
            assetId: 'media1',
            type: 'audio',
            time: { start: 3, duration: 2, sourceStart: 10 },
          },
        ],
      },
    ];

    const clipMediaMap = {
      media1: {
        media: {
          id: 'media1',
          mediaData: { audio: true },
        },
        filePath: '/tmp/source.mp4',
      } as any,
    };

    const executeSpy = vi.spyOn(ffmpegService, 'executeWithProgress');
    await executor.execute(tracks, clipMediaMap, '/tmp/output.mp4', {
      codec: 'libx264',
      format: 'mp4',
      resolution: '1920x1080',
    });

    const args = executeSpy.mock.calls[0][0] as string[];
    const filterComplex = args[args.indexOf('-filter_complex') + 1];
    const joined = args.join(' ');

    // Audio segments get their own seeked inputs instead of atrim
    expect(joined).toContain('-ss 1 -t 3 -i /tmp/source.mp4');
    expect(joined).toContain('-ss 10 -t 2 -i /tmp/source.mp4');
    expect(filterComplex).toContain('adelay=0|0');
    expect(filterComplex).toContain('adelay=3000|3000');
  });

  it('should handle multiple tracks with different layer order', async () => {
    const tracks: TimelineTrack[] = [
      {
        id: 't0',
        type: 'video',
        layer: 0,
        segments: [
          {
            id: 's0',
            assetId: 'bg',
            type: 'video',
            time: { start: 0, duration: 10, sourceStart: 0 },
          },
        ],
      },
      {
        id: 't1',
        type: 'video',
        layer: 1,
        segments: [
          {
            id: 's1',
            assetId: 'fg',
            type: 'video',
            time: { start: 2, duration: 4, sourceStart: 0 },
            video: { x: 50, y: 50, width: 200, height: 200 },
          },
        ],
      },
    ];

    const clipMediaMap = {
      bg: { media: { id: 'bg' }, filePath: '/tmp/bg.mp4' } as any,
      fg: { media: { id: 'fg' }, filePath: '/tmp/fg.mp4' } as any,
    };

    const executeSpy = vi.spyOn(ffmpegService, 'executeWithProgress');
    await executor.execute(tracks, clipMediaMap, '/tmp/output.mp4', {
      codec: 'libx264',
      format: 'mp4',
      resolution: '1920x1080',
    });

    const args = executeSpy.mock.calls[0][0] as string[];
    const filterComplex = args[args.indexOf('-filter_complex') + 1];

    expect(filterComplex).toContain('scale=200:200');
    expect(filterComplex).toContain('overlay=x=50:y=50');
  });

  it('should swap dimensions when orientation=portrait and resolution is landscape', async () => {
    const tracks: TimelineTrack[] = [
      {
        id: 'track1',
        type: 'video',
        layer: 0,
        segments: [
          {
            id: 'seg1',
            assetId: 'asset1',
            type: 'video',
            time: { start: 0, duration: 5, sourceStart: 0 },
          },
        ],
      },
    ];

    const clipMediaMap = {
      asset1: {
        media: { id: 'asset1' },
        filePath: '/tmp/landscape.mp4',
      } as any,
    };

    const executeSpy = vi.spyOn(ffmpegService, 'executeWithProgress');
    await executor.execute(tracks, clipMediaMap, '/tmp/output.mp4', {
      codec: 'libx264',
      format: 'mp4',
      resolution: '1920x1080',
      orientation: TimelineOrientation.PORTRAIT,
    });

    const args = executeSpy.mock.calls[0][0] as string[];
    const filterComplex = args[args.indexOf('-filter_complex') + 1];

    // -s was removed (the filtergraph already emits canvas-sized frames)
    expect(args).not.toContain('-s');
    expect(filterComplex).toContain('color=c=black:s=1080x1920');
    // Letterboxing preserves aspect ratio — never stretches
    expect(filterComplex).toContain(
      'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920'
    );
  });

  it('should keep dimensions when orientation matches resolution', async () => {
    const tracks: TimelineTrack[] = [
      {
        id: 'track1',
        type: 'video',
        layer: 0,
        segments: [
          {
            id: 'seg1',
            assetId: 'asset1',
            type: 'video',
            time: { start: 0, duration: 5, sourceStart: 0 },
          },
        ],
      },
    ];

    const clipMediaMap = {
      asset1: { media: { id: 'asset1' }, filePath: '/tmp/source.mp4' } as any,
    };

    const executeSpy = vi.spyOn(ffmpegService, 'executeWithProgress');
    await executor.execute(tracks, clipMediaMap, '/tmp/output.mp4', {
      codec: 'libx264',
      format: 'mp4',
      resolution: '1920x1080',
      orientation: TimelineOrientation.LANDSCAPE,
    });

    const args = executeSpy.mock.calls[0][0] as string[];
    const filterComplex = args[args.indexOf('-filter_complex') + 1];
    expect(filterComplex).toContain('color=c=black:s=1920x1080');
  });

  it('should skip audio filters for media without audio streams', async () => {
    const tracks: TimelineTrack[] = [
      {
        id: 'track1',
        type: 'audio',
        layer: 0,
        segments: [
          {
            id: 'seg1',
            assetId: 'asset-no-audio',
            type: 'audio',
            time: { start: 0, duration: 5, sourceStart: 0 },
          },
        ],
      },
    ];

    const clipMediaMap = {
      'asset-no-audio': {
        media: {
          id: 'asset-no-audio',
          mediaData: {
            video: {
              codec: 'h264',
              width: 1920,
              height: 1080,
            },
          },
        },
        filePath: '/tmp/no-audio.mp4',
      } as any,
    };

    const outputSettings = {
      codec: 'libx264',
      format: 'mp4',
      resolution: '1920x1080',
    };

    await executor.execute(
      tracks,
      clipMediaMap,
      '/tmp/output.mp4',
      outputSettings
    );

    const executeSpy = vi.spyOn(ffmpegService, 'executeWithProgress');
    const args = executeSpy.mock.calls[0][0] as string[];
    const filterComplex = args[args.indexOf('-filter_complex') + 1];

    // Should not contain audio trim/delay for seg1
    expect(filterComplex).not.toContain('atrim');
    expect(filterComplex).not.toContain('adelay');
    // Should use anullsrc fallback for the mix
    expect(filterComplex).toContain('anullsrc');
  });

  describe('nested timelines (flattened by generateTracks)', () => {
    // End-to-end contract: flatten a timeline containing a nested-timeline
    // clip with the real shared flattener, then verify the compose executor
    // builds a coherent filter graph from the result (fractional layers,
    // projected times, sourceStart offsets, projected audio).
    function buildNestedTracks(): TimelineTrack[] {
      const parentTrack = {
        id: 'p0',
        TimelineRef: 'root',
        layer: 0,
        volume: 1,
        opacity: 1,
        isMuted: false,
        isLocked: false,
      } as unknown as TimelineTrackRecord;

      const childTrack = {
        id: 'c0',
        TimelineRef: 'sub',
        layer: 0,
        volume: 1,
        opacity: 1,
        isMuted: false,
        isLocked: false,
      } as unknown as TimelineTrackRecord;

      const parentClips = [
        {
          id: 'own',
          TimelineRef: 'root',
          TimelineTrackRef: 'p0',
          MediaRef: 'assetMain',
          order: 0,
          start: 0,
          end: 4,
          duration: 4,
          timelineStart: 0,
        },
        // Nested clip at 4s, trimmed to child time [1, 5)
        {
          id: 'nest',
          TimelineRef: 'root',
          TimelineTrackRef: 'p0',
          SourceTimelineRef: 'sub',
          order: 1,
          start: 1,
          end: 5,
          duration: 4,
          timelineStart: 4,
        },
      ] as unknown as TimelineClip[];

      const childClips = [
        // 6s of assetNested starting at source 3s, placed at child 0s
        {
          id: 'subclip',
          TimelineRef: 'sub',
          TimelineTrackRef: 'c0',
          MediaRef: 'assetNested',
          order: 0,
          start: 3,
          end: 9,
          duration: 6,
          timelineStart: 0,
        },
      ] as unknown as TimelineClip[];

      return generateTracks(parentClips, [parentTrack], {
        rootTimelineId: 'root',
        nestedTimelines: {
          sub: { clips: childClips, tracks: [childTrack] },
        },
      });
    }

    const clipMediaMap = {
      assetMain: {
        media: { id: 'assetMain', mediaData: { audio: { codec: 'aac' } } },
        filePath: '/tmp/main.mp4',
      } as any,
      assetNested: {
        media: { id: 'assetNested', mediaData: { audio: { codec: 'aac' } } },
        filePath: '/tmp/nested.mp4',
      } as any,
    };

    const outputSettings = {
      codec: 'libx264',
      format: 'mp4',
      resolution: '1920x1080',
    };

    it('renders projected nested video above the parent track content', async () => {
      const tracks = buildNestedTracks();

      await executor.execute(
        tracks,
        clipMediaMap,
        '/tmp/output.mp4',
        outputSettings
      );

      const executeSpy = vi.spyOn(ffmpegService, 'executeWithProgress');
      const args = executeSpy.mock.calls[0][0] as string[];
      const filterComplex = args[args.indexOf('-filter_complex') + 1];

      // Both source files are inputs
      expect(args).toContain('/tmp/main.mp4');
      expect(args).toContain('/tmp/nested.mp4');

      // Parent clip plays [0,4)
      expect(filterComplex).toContain("enable='between(t,0,3.983333)'");
      // Nested child clip [0,6) trimmed to [1,5) => parent window [4,8),
      // source in-point 3 + 1 head-trim = 4 (input-level seek)
      expect(args.join(' ')).toContain('-ss 4 -t 4 -i /tmp/nested.mp4');
      expect(filterComplex).toContain("enable='between(t,3.983333,7.983333)'");

      // Canvas spans the full 8s composition
      expect(filterComplex).toContain('d=8[base]');
    });

    it('mixes the nested timeline audio with projected timing', async () => {
      const tracks = buildNestedTracks();

      await executor.execute(
        tracks,
        clipMediaMap,
        '/tmp/output.mp4',
        outputSettings
      );

      const executeSpy = vi.spyOn(ffmpegService, 'executeWithProgress');
      const args = executeSpy.mock.calls[0][0] as string[];
      const filterComplex = args[args.indexOf('-filter_complex') + 1];

      // Nested audio: its own input seeked to source 4s for 4s, delayed to 4s
      expect(args.join(' ')).toContain('-ss 4 -t 4 -i /tmp/nested.mp4');
      expect(filterComplex).toContain('adelay=4000|4000');
      // Parent audio + nested audio both feed the mix
      expect(filterComplex).toMatch(/amix=inputs=2/);
    });

    it('orders fractional-layer nested tracks between integer layers', () => {
      const tracks = buildNestedTracks();

      const nestedVideo = tracks.find(
        (t) => t.type === 'video' && t.id.startsWith('nest_')
      );
      expect(nestedVideo).toBeDefined();
      expect(nestedVideo!.layer).toBeGreaterThan(0);
      expect(nestedVideo!.layer).toBeLessThan(1);

      // The compose sort places the nested track after the parent track
      const sorted = [...tracks]
        .filter((t) => t.type === 'video')
        .sort((a, b) => (a.layer || 0) - (b.layer || 0));
      expect(sorted[0].id).toBe('p0');
      expect(sorted[1].id).toBe(nestedVideo!.id);
    });
  });

  describe('frame-exact cuts (black-frame regression)', () => {
    // Composite dialogue cuts land on the millisecond grid (word boundaries),
    // which the 1/fps frame grid does not contain — e.g. 10.234s falls
    // between frames at 30fps. Rendered naively this leaves 1–2 output frame
    // slots at each cut covered by neither neighbor, which the overlay chain
    // fills with the black base canvas: the "occasional black frame" bug.
    // These tests pin the two defenses: frame-grid quantization with
    // half-frame enable windows (no slot is ever ambiguous or unowned), and
    // eof_action=repeat (a short-decoding branch holds its last frame
    // instead of dropping to black).

    const clipMediaMap = {
      m1: { media: { id: 'm1' }, filePath: '/tmp/source.mp4' } as any,
    };

    const baseSettings = {
      codec: 'libx264',
      format: 'mp4',
      resolution: '1920x1080',
    };

    const run = async (
      tracks: TimelineTrack[],
      outputSettings: Record<string, unknown> = {}
    ) => {
      const executeSpy = vi.spyOn(ffmpegService, 'executeWithProgress');
      await executor.execute(tracks, clipMediaMap, '/tmp/output.mp4', {
        ...baseSettings,
        ...outputSettings,
      } as never);
      const args = executeSpy.mock.calls[0][0] as string[];
      return {
        args,
        joined: args.join(' '),
        filterComplex: args[args.indexOf('-filter_complex') + 1],
      };
    };

    const segment = (
      id: string,
      start: number,
      duration: number,
      sourceStart: number
    ) => ({
      id,
      assetId: 'm1',
      type: 'video' as const,
      time: { start, duration, sourceStart },
    });

    const track = (segments: TimelineTrack['segments']): TimelineTrack[] => [
      { id: 'track1', type: 'video', layer: 0, segments },
    ];

    it('tiles ms-grid word-boundary cuts with no unowned frame slot', async () => {
      // A word cut at 10.234s — NOT on the 30fps grid (10.234 × 30 = 307.02)
      const { filterComplex } = await run(
        track([segment('a', 0, 10.234, 1.5), segment('b', 10.234, 1.767, 14.9)])
      );

      // Both sides quantize to frame 307, and the shared boundary appears as
      // the SAME half-frame string (306.5/30) in both enable windows: frame
      // 306 belongs to `a`, frame 307 to `b`, nothing to neither.
      const enables = [...filterComplex.matchAll(/between\(t,([^)]+)\)/g)].map(
        (m) => m[1].split(',')
      );
      expect(enables).toHaveLength(2);
      const [[aFrom, aTo], [bFrom, bTo]] = enables;
      expect(aFrom).toBe('0');
      expect(aTo).toBe(bFrom); // exact string equality — no gap, no overlap
      expect(aTo).toBe('10.216667'); // (307 − 0.5)/30
      expect(bTo).toBe('11.983333'); // round(12.001·30)=360 → (360 − 0.5)/30
    });

    it('holds the last frame at a cut instead of dropping to black canvas', async () => {
      const { filterComplex } = await run(
        track([segment('a', 0, 10.234, 1.5), segment('b', 10.234, 2, 14.9)])
      );

      // eof_action=repeat: when a branch's decoded frames run out before its
      // enable window closes (24fps source on a 30fps grid, VFR, seek slop),
      // the overlay repeats its last frame rather than passing the black
      // base through.
      expect(filterComplex).toContain('eof_action=repeat');
      expect(filterComplex).not.toContain('eof_action=pass');
    });

    it('is immune to float drift between two expressions of one boundary', async () => {
      // 0.1+0.2 !== 0.3 in floats; both sides of the seam must still
      // quantize to the same frame because rounding goes through integer ms.
      const seamAsSum = 0.1 + 0.2; // 0.30000000000000004
      const { filterComplex } = await run(
        track([segment('a', 0, seamAsSum, 0), segment('b', 0.3, 0.5, 5)])
      );

      const enables = [...filterComplex.matchAll(/between\(t,([^)]+)\)/g)].map(
        (m) => m[1].split(',')
      );
      const [[, aTo], [bFrom]] = enables;
      expect(aTo).toBe(bFrom);
    });

    it('drops sub-frame slivers without disturbing their neighbors', async () => {
      // 10ms sliver between two real segments: less than half a frame at
      // 30fps, so it can never own an output frame — it must vanish rather
      // than open a seeked input (and its neighbors still tile).
      const { filterComplex, args } = await run(
        track([
          segment('a', 0, 5, 0),
          segment('sliver', 5, 0.01, 30),
          segment('b', 5.01, 4.99, 40),
        ])
      );

      expect(args.filter((a) => a === '-i')).toHaveLength(2);
      expect(filterComplex).not.toContain('v_seg_sliver');
      const enables = [...filterComplex.matchAll(/between\(t,([^)]+)\)/g)].map(
        (m) => m[1].split(',')
      );
      expect(enables).toHaveLength(2);
      const [[, aTo], [bFrom]] = enables;
      // a ends at frame 150, b starts at frame round(5010·30/1000)=150 — the
      // sliver's slot collapses and the survivors still share a boundary.
      expect(aTo).toBe(bFrom);
    });

    it('honors outputSettings.fps for the whole grid (canvas, branches, cuts)', async () => {
      const { filterComplex, joined } = await run(
        track([segment('a', 0, 5, 2), segment('b', 5, 5, 20)]),
        { fps: 24 }
      );

      expect(filterComplex).toContain(':r=24:');
      expect(filterComplex).toContain('fps=24');
      expect(joined).toContain('-ss 2 -t 5 -i /tmp/source.mp4');
      // Cut at 5s = frame 120 at 24fps → boundary (120 − 0.5)/24
      expect(filterComplex).toContain("enable='between(t,0,4.979167)'");
      expect(filterComplex).toContain("enable='between(t,4.979167,9.979167)'");
    });

    it('falls back to 30fps for non-integer rates', async () => {
      const { filterComplex } = await run(track([segment('a', 0, 5, 0)]), {
        fps: 29.97,
      });
      expect(filterComplex).toContain(':r=30:');
      expect(filterComplex).toContain('fps=30');
    });
  });

  describe('composite trim window (flattened by generateTracks)', () => {
    // End-to-end contract for non-destructive composite trims: the clip's
    // start/end WINDOW the edit list (the list itself is stored in full),
    // and the render must decode exactly the windowed content — nothing
    // from the trimmed-away portions may reach ffmpeg.
    const track = {
      id: 't0',
      TimelineRef: 'root',
      layer: 0,
      volume: 1,
      opacity: 1,
      isMuted: false,
      isLocked: false,
    } as unknown as TimelineTrackRecord;

    // Full edit list: [2,8] + [20,26] = 12s effective
    const editList = [
      { start: 2, end: 8 },
      { start: 20, end: 26 },
    ];

    const makeCompositeClip = (start: number, end: number, duration: number) =>
      [
        {
          id: 'comp',
          TimelineRef: 'root',
          TimelineTrackRef: 't0',
          MediaRef: 'media1',
          order: 0,
          start,
          end,
          duration,
          timelineStart: 0,
          meta: { segments: editList },
        },
      ] as unknown as TimelineClip[];

    const clipMediaMap = {
      media1: {
        media: { id: 'media1', mediaData: { audio: { codec: 'aac' } } },
        filePath: '/tmp/source.mp4',
      } as any,
    };

    const outputSettings = {
      codec: 'libx264',
      format: 'mp4',
      resolution: '1920x1080',
    };

    const run = async (clips: TimelineClip[]) => {
      const executeSpy = vi.spyOn(ffmpegService, 'executeWithProgress');
      await executor.execute(
        generateTracks(clips, [track]),
        clipMediaMap,
        '/tmp/output.mp4',
        outputSettings
      );
      const args = executeSpy.mock.calls[0][0] as string[];
      return {
        joined: args.join(' '),
        filterComplex: args[args.indexOf('-filter_complex') + 1],
      };
    };

    it('renders only the windowed portion of the edit list', async () => {
      // Window 4–23 keeps [4,8] (4s) + [20,23] (3s) = 7s effective
      const { joined, filterComplex } = await run(makeCompositeClip(4, 23, 7));

      // Decode windows are the INTERSECTED segments, not the stored list
      expect(joined).toContain('-ss 4 -t 4 -i /tmp/source.mp4');
      expect(joined).toContain('-ss 20 -t 3 -i /tmp/source.mp4');
      // The trimmed-away head (source 2–4) is never opened or decoded
      expect(joined).not.toContain('-ss 2 ');

      // Segments land back-to-back in effective time
      expect(filterComplex).toContain("enable='between(t,0,3.983333)'");
      expect(filterComplex).toContain("enable='between(t,3.983333,6.983333)'");
      // The canvas spans the windowed effective duration, not the full 12s
      expect(filterComplex).toContain('d=7[base]');
      expect(filterComplex).not.toContain('d=12[base]');

      // The mirrored audio segments carry the same window
      expect(filterComplex).toContain('adelay=0|0');
      expect(filterComplex).toContain('adelay=4000|4000');
    });

    it('renders the full edit list once the window is expanded back (untrim)', async () => {
      // Window re-opened to the full span — the list was never destroyed,
      // so everything comes back
      const { joined, filterComplex } = await run(makeCompositeClip(2, 26, 12));

      expect(joined).toContain('-ss 2 -t 6 -i /tmp/source.mp4');
      expect(joined).toContain('-ss 20 -t 6 -i /tmp/source.mp4');
      expect(filterComplex).toContain("enable='between(t,0,5.983333)'");
      expect(filterComplex).toContain("enable='between(t,5.983333,11.983333)'");
      expect(filterComplex).toContain('d=12[base]');
    });

    it('drops edit-list segments that fall entirely outside the window', async () => {
      // Window 20–23 keeps only part of the second segment
      const { joined, filterComplex } = await run(makeCompositeClip(20, 23, 3));

      expect(joined).toContain('-ss 20 -t 3 -i /tmp/source.mp4');
      // The first segment (source 2–8) is gone entirely
      expect(joined).not.toContain('-ss 2 ');
      expect(filterComplex).toContain("enable='between(t,0,2.983333)'");
      expect(filterComplex).toContain('d=3[base]');
      // Exactly one video overlay + one audio branch survive
      expect(filterComplex).toMatch(/amix=inputs=1/);
    });

    it('windows a composite MediaClip edit list by the placement window', async () => {
      // No meta.segments — the edit list lives on the source MediaClip and
      // the TimelineClip's start/end window it per placement
      const clips = [
        {
          id: 'placed',
          TimelineRef: 'root',
          TimelineTrackRef: 't0',
          MediaRef: 'media1',
          MediaClipRef: 'mc1',
          order: 0,
          start: 22,
          end: 26,
          duration: 4,
          timelineStart: 0,
          expand: {
            MediaClipRef: {
              id: 'mc1',
              type: 'composite',
              MediaRef: 'media1',
              start: 2,
              end: 26,
              clipData: { segments: editList },
            },
          },
        },
      ] as unknown as TimelineClip[];

      const { joined, filterComplex } = await run(clips);

      expect(joined).toContain('-ss 22 -t 4 -i /tmp/source.mp4');
      expect(joined).not.toContain('-ss 2 ');
      expect(joined).not.toContain('-ss 20 ');
      expect(filterComplex).toContain("enable='between(t,0,3.983333)'");
      expect(filterComplex).toContain('d=4[base]');
    });
  });
});
