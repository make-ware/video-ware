import { vi, describe, it, expect } from 'vitest';
import { FFmpegResolveClipsExecutor } from '../resolve-clips.executor';
import type { RenderTimelinePayload } from '@project/shared';

/**
 * A media-free timeline is renderable: captions/titles draw onto the compose
 * executor's black base canvas, whose graph needs no ffmpeg inputs at all.
 * PREPARE only refuses a payload where nothing would draw.
 */
describe('FFmpegResolveClipsExecutor with no media', () => {
  const captionTracks = (text: string): RenderTimelinePayload['tracks'] => [
    {
      id: 'captions',
      type: 'text',
      layer: 1,
      segments: [
        {
          id: 'seg-captions',
          type: 'text',
          time: { start: 0, duration: 4 },
          text: { content: text, role: 'caption' },
        },
      ],
    },
  ];

  // Neither service is touched on the media-free path — a caption-only render
  // must not hit PocketBase or storage at all.
  const newExecutor = () => {
    const pocketbase = { getMedia: vi.fn(), getUploadByMedia: vi.fn() };
    const storage = { resolveFilePath: vi.fn(), getBasePath: vi.fn() };
    const executor = new FFmpegResolveClipsExecutor(
      pocketbase as never,
      storage as never
    );
    return { executor, pocketbase, storage };
  };

  it('resolves an empty clip map for a caption-only timeline', async () => {
    const { executor, pocketbase, storage } = newExecutor();

    const result = await executor.execute('tl1', captionTracks('Hello world'));

    expect(result.clipMediaMap).toEqual({});
    expect(pocketbase.getMedia).not.toHaveBeenCalled();
    expect(storage.resolveFilePath).not.toHaveBeenCalled();
  });

  it('fails when no media and nothing would draw', async () => {
    const { executor } = newExecutor();

    await expect(executor.execute('tl1', captionTracks(''))).rejects.toThrow(
      /Nothing to render for timeline tl1/
    );
  });

  it('fails on a timeline with no segments at all', async () => {
    const { executor } = newExecutor();

    await expect(
      executor.execute('tl1', [
        { id: 'track1', type: 'video', layer: 0, segments: [] },
      ])
    ).rejects.toThrow(/Nothing to render for timeline tl1/);
  });
});
