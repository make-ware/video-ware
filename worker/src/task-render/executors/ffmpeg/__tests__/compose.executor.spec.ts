import { vi, describe, it, expect } from 'vitest';
import { FFmpegComposeExecutor } from '../compose.executor';
import type { RenderTimelinePayload } from '@project/shared';

/**
 * Regression test for the drawtext escaping bug: a caption/transcript cue
 * containing an ASCII apostrophe used to break ffmpeg filtergraph quoting,
 * crashing the render with "Filter not found" (exit 8). The text is now mapped
 * to a typographic apostrophe so the single-quoted drawtext value stays intact.
 */
describe('FFmpegComposeExecutor drawtext escaping', () => {
  function runWithCaption(text: string) {
    let capturedArgs: string[] = [];
    const ffmpegService = {
      executeWithProgress: vi.fn().mockImplementation((args: string[]) => {
        capturedArgs = args;
        return Promise.resolve();
      }),
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
          duration: '4',
          bit_rate: '1000',
          size: '1000',
          format_name: 'mp4',
        },
      }),
    };

    const executor = new FFmpegComposeExecutor(ffmpegService as never);

    const tracks: RenderTimelinePayload['tracks'] = [
      {
        id: 'captions',
        type: 'text',
        layer: 1,
        segments: [
          {
            id: 'seg-captions',
            type: 'text',
            time: { start: 0, duration: 4 },
            text: {
              content: '',
              cues: [{ text, start: 0, end: 2 }],
              fontSize: 48,
              position: 'bottom',
              align: 'center',
            },
          },
        ],
      },
    ];

    return executor
      .execute(tracks, {}, '/tmp/out.mp4', {
        codec: 'libx264',
        format: 'mp4',
        resolution: '1920x1080',
        includeCaptions: true,
      })
      .then(() => {
        const idx = capturedArgs.indexOf('-filter_complex');
        expect(idx).toBeGreaterThanOrEqual(0);
        return capturedArgs[idx + 1];
      });
  }

  it('keeps filtergraph quoting intact for apostrophes (no crash)', async () => {
    const filter = await runWithCaption("It's making me look very surprised.");

    // Apostrophe is mapped to the typographic glyph, not a quote-breaking \'
    expect(filter).toContain('It’s making me look very surprised.');
    expect(filter).not.toMatch(/It\\'s/);
    // The per-cue enable expression stays intact (its commas must remain quoted)
    expect(filter).toContain("enable='between(t,");
  });

  it('escapes colons but leaves percent literal (expansion=none)', async () => {
    const filter = await runWithCaption('rate: 100% now');
    // % must NOT be escaped: with the default expansion mode there is no
    // working escape ("\%"/"%%" both log "Stray %" and blank the whole cue),
    // so drawtext runs with expansion=none and the raw % passes through.
    expect(filter).toContain('rate\\: 100% now');
    expect(filter).toContain('drawtext=expansion=none:text=');
  });
});

/**
 * The job failure record is often all an operator sees. The per-segment-input
 * model means input count — not track or media count — is what drives thread
 * and memory exhaustion, so composition failures must carry the graph shape.
 */
describe('FFmpegComposeExecutor failure context', () => {
  it('appends the render graph shape to composition failures', async () => {
    const ffmpegService = {
      executeWithProgress: vi
        .fn()
        .mockRejectedValue(
          new Error(
            'FFmpeg execution failed: ffmpeg exited with code 245 (EAGAIN: resource temporarily unavailable)'
          )
        ),
      probe: vi.fn(),
    };
    const executor = new FFmpegComposeExecutor(ffmpegService as never);

    // Two segments of the same asset → two seeked inputs
    const tracks: RenderTimelinePayload['tracks'] = [
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
            assetId: 'asset1',
            type: 'video',
            time: { start: 5, duration: 5, sourceStart: 10 },
          },
        ],
      },
    ];
    const clipMediaMap = {
      asset1: {
        media: { id: 'asset1' } as never,
        filePath: '/tmp/1.mp4',
      },
    };

    const err: Error = await executor
      .execute(tracks, clipMediaMap, '/tmp/out.mp4', {
        codec: 'libx264',
        format: 'mp4',
        resolution: '1920x1080',
      })
      .then(() => {
        throw new Error('expected rejection');
      })
      .catch((e: Error) => e);

    expect(err.message).toContain('exited with code 245');
    expect(err.message).toContain('[render graph: 2 inputs across 1 tracks]');
  });
});
