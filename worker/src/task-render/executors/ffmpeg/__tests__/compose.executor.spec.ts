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
