import { describe, it, expect } from 'vitest';
import { generateTracks, type TimelineClipWithExpand } from '../edit-list';
import type { TimelineClip } from '../../schema/timeline-clip';
import type { Caption } from '../../schema/caption';
import type { TimelineTrackRecord } from '../../schema';

const track: TimelineTrackRecord = {
  id: 'track1',
  layer: 1,
  TimelineRef: 'timeline1',
  opacity: 1,
  isMuted: false,
  volume: 1,
  name: 'Overlay',
  isLocked: false,
} as unknown as TimelineTrackRecord;

const caption: Caption = {
  id: 'cap1',
  WorkspaceRef: 'ws1',
  captionType: 'caption',
  text: 'Hello world',
  cues: [
    { text: 'Hello', start: 0, end: 2 },
    { text: 'world', start: 2, end: 4 },
  ],
  duration: 4,
  style: {
    fontSize: 48,
    color: '#FFFFFF',
    backgroundColor: '#000000',
    position: 'bottom',
    align: 'center',
  },
} as unknown as Caption;

function makeCaptionClip(
  overrides: Partial<TimelineClip> = {}
): TimelineClipWithExpand {
  return {
    id: 'clip1',
    TimelineRef: 'timeline1',
    TimelineTrackRef: 'track1',
    CaptionRef: 'cap1',
    start: 0,
    end: 4,
    duration: 4,
    order: 0,
    timelineStart: 10,
    expand: { CaptionRef: caption },
    ...overrides,
  } as unknown as TimelineClipWithExpand;
}

describe('generateTracks with caption clips', () => {
  it('emits a text segment carrying caption content, cues, and style', () => {
    const tracks = generateTracks([makeCaptionClip()], [track]);

    const videoTrack = tracks.find((t) => t.id === 'track1');
    expect(videoTrack).toBeDefined();
    expect(videoTrack!.segments).toHaveLength(1);

    const seg = videoTrack!.segments[0];
    expect(seg.type).toBe('text');
    expect(seg.assetId).toBeUndefined();
    expect(seg.time).toEqual({ start: 10, duration: 4 });
    expect(seg.text).toMatchObject({
      content: 'Hello world',
      cues: [
        { text: 'Hello', start: 0, end: 2 },
        { text: 'world', start: 2, end: 4 },
      ],
      fontSize: 48,
      color: '#FFFFFF',
      backgroundColor: '#000000',
      position: 'bottom',
      align: 'center',
    });
  });

  it('clamps and re-bases cues when the caption clip is trimmed', () => {
    const tracks = generateTracks(
      [makeCaptionClip({ start: 1, end: 3, duration: 2 })],
      [track]
    );

    const seg = tracks.find((t) => t.id === 'track1')!.segments[0];
    expect(seg.time).toEqual({ start: 10, duration: 2 });
    expect(seg.text?.cues).toEqual([
      { text: 'Hello', start: 0, end: 1 },
      { text: 'world', start: 1, end: 2 },
    ]);
  });

  it('does not generate audio segments for caption clips', () => {
    const tracks = generateTracks([makeCaptionClip()], [track]);
    const audioTrack = tracks.find((t) => t.id === 'track1-audio');
    expect(audioTrack).toBeDefined();
    expect(audioTrack!.segments).toHaveLength(0);
  });

  it('omits cues for static captions', () => {
    const staticCaption = { ...caption, cues: [] } as unknown as Caption;
    const clip = makeCaptionClip();
    clip.expand = { CaptionRef: staticCaption };

    const tracks = generateTracks([clip], [track]);
    const seg = tracks.find((t) => t.id === 'track1')!.segments[0];
    expect(seg.text?.cues).toBeUndefined();
    expect(seg.text?.content).toBe('Hello world');
  });
});
