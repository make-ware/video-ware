import { describe, it, expect } from 'vitest';
import { summarizeRenderContent, textSegmentDraws } from '../render-content';
import type { TimelineTrack } from '../../types/task-contracts';

const captionTrack = (segments: TimelineTrack['segments']): TimelineTrack[] => [
  { id: 'captions', type: 'text', layer: 1, segments },
];

describe('summarizeRenderContent', () => {
  it('treats a caption-only timeline as renderable content', () => {
    const summary = summarizeRenderContent(
      captionTrack([
        {
          id: 'seg-caption',
          type: 'text',
          time: { start: 2, duration: 6 },
          text: { content: 'Hello world', role: 'caption' },
        },
      ])
    );

    expect(summary.mediaIds).toEqual([]);
    expect(summary.drawableTextSegments).toBe(1);
    expect(summary.duration).toBe(8);
    expect(summary.hasContent).toBe(true);
  });

  it('counts cue-driven captions with no static content', () => {
    const summary = summarizeRenderContent(
      captionTrack([
        {
          id: 'seg-cues',
          type: 'text',
          time: { start: 0, duration: 4 },
          text: {
            content: '',
            cues: [{ text: 'spoken line', start: 0, end: 2 }],
          },
        },
      ])
    );

    expect(summary.drawableTextSegments).toBe(1);
    expect(summary.hasContent).toBe(true);
  });

  it('does not count text that would draw nothing', () => {
    const summary = summarizeRenderContent(
      captionTrack([
        {
          id: 'seg-blank',
          type: 'text',
          time: { start: 0, duration: 4 },
          text: { content: '   ' },
        },
        {
          id: 'seg-empty-cues',
          type: 'text',
          time: { start: 4, duration: 4 },
          text: { content: '', cues: [{ text: '', start: 0, end: 2 }] },
        },
        {
          id: 'seg-zero-length',
          type: 'text',
          time: { start: 8, duration: 0 },
          text: { content: 'never on screen' },
        },
      ])
    );

    expect(summary.drawableTextSegments).toBe(0);
    expect(summary.duration).toBe(8);
    expect(summary.hasContent).toBe(false);
  });

  it('has no content when every track is empty', () => {
    const summary = summarizeRenderContent([
      { id: 'v', type: 'video', layer: 0, segments: [] },
    ]);

    expect(summary.duration).toBe(0);
    expect(summary.hasContent).toBe(false);
  });

  it('dedupes media ids and keeps zero-duration media segments', () => {
    // The compose graph looks every assetId up in clipMediaMap BEFORE it
    // decides a sub-frame segment can be skipped, so a zero-duration media
    // segment must still be resolved.
    const summary = summarizeRenderContent([
      {
        id: 'v',
        type: 'video',
        layer: 0,
        segments: [
          {
            id: 's1',
            assetId: 'media1',
            type: 'video',
            time: { start: 0, duration: 5, sourceStart: 0 },
          },
          {
            id: 's2',
            assetId: 'media1',
            type: 'video',
            time: { start: 5, duration: 5, sourceStart: 10 },
          },
          {
            id: 's3',
            assetId: 'media2',
            type: 'video',
            time: { start: 10, duration: 0, sourceStart: 0 },
          },
        ],
      },
    ]);

    expect(summary.mediaIds).toEqual(['media1', 'media2']);
    expect(summary.duration).toBe(10);
    expect(summary.hasContent).toBe(true);
  });
});

describe('textSegmentDraws', () => {
  it('ignores non-text segments', () => {
    expect(
      textSegmentDraws({
        id: 's1',
        assetId: 'media1',
        type: 'video',
        time: { start: 0, duration: 5 },
      })
    ).toBe(false);
  });

  it('ignores cues whose window is inverted or empty', () => {
    expect(
      textSegmentDraws({
        id: 's1',
        type: 'text',
        time: { start: 0, duration: 5 },
        text: { content: 'fallback', cues: [{ text: 'x', start: 2, end: 2 }] },
      })
    ).toBe(false);
  });
});
