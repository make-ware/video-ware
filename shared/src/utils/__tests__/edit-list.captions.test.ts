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

const transcript = {
  transcript: 'Hello world foo bar',
  start: 0,
  end: 4,
  words: [
    { word: 'Hello', startTime: 0, endTime: 1, confidence: 0.9 },
    { word: 'world', startTime: 1, endTime: 2, confidence: 0.9 },
    { word: 'foo', startTime: 2, endTime: 3, confidence: 0.9 },
    { word: 'bar', startTime: 3, endTime: 4, confidence: 0.9 },
  ],
};

const transcriptsByMedia = { media1: [transcript] };

function makeMediaClip(
  overrides: Partial<TimelineClip> = {}
): TimelineClipWithExpand {
  return {
    id: 'mclip1',
    TimelineRef: 'timeline1',
    TimelineTrackRef: 'track1',
    MediaRef: 'media1',
    start: 0,
    end: 4,
    duration: 4,
    order: 0,
    timelineStart: 10,
    ...overrides,
  } as unknown as TimelineClipWithExpand;
}

describe('generateTracks with media-clip transcript captions', () => {
  it('emits a single-line caption text segment alongside the video segment', () => {
    const tracks = generateTracks([makeMediaClip()], [track], {
      transcriptsByMedia,
    });

    const segments = tracks.find((t) => t.id === 'track1')!.segments;
    expect(segments).toHaveLength(2);

    const videoSeg = segments.find((s) => s.type === 'video');
    expect(videoSeg?.assetId).toBe('media1');

    const textSeg = segments.find((s) => s.type === 'text');
    expect(textSeg?.id).toBe('mclip1-captions');
    expect(textSeg?.time).toEqual({ start: 10, duration: 4 });
    expect(textSeg?.text?.cues).toEqual([
      { text: 'Hello world foo bar', start: 0, end: 4 },
    ]);
    expect(textSeg?.text).toMatchObject({
      fontSize: 48,
      position: 'bottom',
      align: 'center',
    });
  });

  it('clamps and re-bases caption cues when the media clip is trimmed', () => {
    const tracks = generateTracks(
      [makeMediaClip({ start: 1, end: 3, duration: 2 })],
      [track],
      { transcriptsByMedia }
    );

    const textSeg = tracks
      .find((t) => t.id === 'track1')!
      .segments.find((s) => s.type === 'text');
    expect(textSeg?.time).toEqual({ start: 10, duration: 2 });
    expect(textSeg?.text?.cues).toEqual([
      { text: 'Hello world foo bar', start: 0, end: 2 },
    ]);
  });

  it('omits transcript captions when includeCaptions is false', () => {
    const tracks = generateTracks([makeMediaClip()], [track], {
      transcriptsByMedia,
      includeCaptions: false,
    });

    const segments = tracks.find((t) => t.id === 'track1')!.segments;
    expect(segments).toHaveLength(1);
    expect(segments.every((s) => s.type !== 'text')).toBe(true);
  });

  it('omits transcript captions when the media has no transcripts', () => {
    const tracks = generateTracks([makeMediaClip()], [track]);

    const segments = tracks.find((t) => t.id === 'track1')!.segments;
    expect(segments).toHaveLength(1);
    expect(segments[0].type).toBe('video');
  });

  it('does not derive transcript captions for composite clips (v1 limitation)', () => {
    const composite = makeMediaClip({
      meta: {
        segments: [
          { start: 0, end: 2 },
          { start: 3, end: 4 },
        ],
      },
    } as unknown as Partial<TimelineClip>);

    const tracks = generateTracks([composite], [track], { transcriptsByMedia });

    const segments = tracks.find((t) => t.id === 'track1')!.segments;
    expect(segments.every((s) => s.type !== 'text')).toBe(true);
  });

  it('does not spawn an audio segment for the caption text segment', () => {
    const tracks = generateTracks([makeMediaClip()], [track], {
      transcriptsByMedia,
    });

    const audioTrack = tracks.find((t) => t.id === 'track1-audio')!;
    expect(audioTrack.segments.every((s) => s.type !== 'text')).toBe(true);
    // Only the video's audio counterpart is emitted.
    expect(audioTrack.segments).toHaveLength(1);
  });
});
