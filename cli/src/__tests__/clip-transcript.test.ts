import { describe, expect, it, vi } from 'vitest';
import {
  mediaClipTranscript,
  timelineClipTranscript,
} from '../lib/clip-transcript.js';
import { fakePb, listResult, type Stub } from './fake-pb.js';

const notFound = () => Object.assign(new Error('not found'), { status: 404 });

interface TranscriptStubOptions {
  mediaClips?: Record<string, unknown>[];
  timelineClips?: Record<string, unknown>[];
  speakerRows?: Record<string, unknown>[];
  speechRows?: Record<string, unknown>[];
}

function transcriptStubs(
  opts: TranscriptStubOptions = {}
): Record<string, Stub> {
  const {
    mediaClips = [],
    timelineClips = [],
    speakerRows = [],
    speechRows = [],
  } = opts;
  const labelList = (rows: Record<string, unknown>[]) => ({
    getList: vi.fn(
      async (
        _page: number,
        _perPage: number,
        _opts: { filter?: string; sort?: string; expand?: string }
      ) => listResult(rows)
    ),
  });
  return {
    Media: {
      getOne: vi.fn(async () => ({
        id: 'm1',
        duration: 60,
        mediaType: 'video',
      })),
    },
    MediaClips: {
      getOne: vi.fn(async (id: string) => {
        const clip = mediaClips.find((c) => c.id === id);
        if (!clip) throw notFound();
        return clip;
      }),
    },
    TimelineClips: {
      getList: vi.fn(async () => listResult(timelineClips)),
      getOne: vi.fn(async (id: string) => {
        const clip = timelineClips.find((c) => c.id === id);
        if (!clip) throw notFound();
        return clip;
      }),
    },
    TimelineTracks: {
      getList: vi.fn(async () =>
        listResult([{ id: 'trk0', layer: 0, name: 'Main', TimelineRef: 'tl1' }])
      ),
    },
    LabelSpeaker: labelList(speakerRows),
    LabelSpeech: labelList(speechRows),
  };
}

// Composite MediaClip: segments [0,10] + [50,60], effective 20 of span 60.
const compositeMediaClip = {
  id: 'mc1',
  MediaRef: 'm1',
  WorkspaceRef: 'ws1',
  type: 'user',
  start: 0,
  end: 60,
  duration: 20,
  clipData: {
    segments: [
      { start: 0, end: 10 },
      { start: 50, end: 60 },
    ],
  },
};

const speakerRow = {
  id: 'ls1',
  MediaRef: 'm1',
  transcript: 'keep this umm cut and this',
  speakerId: 'speaker_0',
  confidence: 0.95,
  start: 8,
  end: 52,
  words: [
    { text: 'keep', start: 8, end: 9, speakerId: 'speaker_0' },
    { text: 'this', start: 9, end: 10, speakerId: 'speaker_0' },
    { text: 'umm', start: 20, end: 21, speakerId: 'speaker_0' },
    { text: 'cut', start: 30, end: 31, speakerId: 'speaker_0' },
    { text: 'and', start: 50, end: 51, speakerId: 'speaker_0' },
    { text: 'this', start: 51, end: 52, speakerId: 'speaker_0' },
  ],
  expand: {
    LabelEntityRef: {
      expand: { EntityRef: { id: 'e1', name: 'Erik', kind: 'person' } },
    },
  },
};

const speechRow = {
  id: 'sp1',
  MediaRef: 'm1',
  transcript: 'google heard this',
  confidence: 0.8,
  start: 2,
  end: 5,
  words: [
    { word: 'google', startTime: 2, endTime: 3 },
    { word: 'heard', startTime: 3, endTime: 4 },
    { word: 'this', startTime: 4, endTime: 5 },
  ],
};

describe('mediaClipTranscript', () => {
  it('trims speaker words through the edit list with attribution', async () => {
    const stubs = transcriptStubs({
      mediaClips: [compositeMediaClip],
      speakerRows: [speakerRow],
    });
    const pb = fakePb(stubs);

    const result = await mediaClipTranscript(pb, 'mc1');

    expect(result.labelType).toBe('speaker');
    expect(result.labelTypeSelected).toBe('auto');
    expect(result.editListSource).toBe('clipData');
    expect(result.domain).toBe('mediaClip');
    // The PB filter was windowed to the edit-list span.
    const filter = stubs.LabelSpeaker.getList.mock.calls[0][2].filter;
    expect(filter).toContain('MediaRef = m1');
    expect(filter).toContain('start < 60');
    expect(filter).toContain('end > 0');
    // Speech was never queried — speaker rows existed.
    expect(stubs.LabelSpeech.getList).not.toHaveBeenCalled();

    expect(result.utterances).toHaveLength(1);
    const u = result.utterances[0];
    expect(u.text).toBe('keep this [cut 40.0s] and this');
    expect(u.speaker).toEqual({
      speakerId: 'speaker_0',
      label: 'Speaker 1 (Erik)',
      entity: { id: 'e1', name: 'Erik', kind: 'person' },
    });
    expect(u.omittedWords).toBe(2);
    expect(u.timelineStart).toBeUndefined();
    // Words stay out of the payload unless requested.
    expect(u.parts[0].words).toBeUndefined();
    expect(result.text).toBe(
      'Speaker 1 (Erik): keep this [cut 40.0s] and this'
    );
    expect(result.gaps).toEqual([{ afterIndex: 0, seconds: 40 }]);
  });

  it('falls back to speech labels when no speaker rows overlap', async () => {
    const stubs = transcriptStubs({
      mediaClips: [compositeMediaClip],
      speechRows: [speechRow],
    });
    const pb = fakePb(stubs);

    const result = await mediaClipTranscript(pb, 'mc1');

    expect(stubs.LabelSpeaker.getList).toHaveBeenCalled();
    expect(result.labelType).toBe('speech');
    expect(result.labelTypeSelected).toBe('auto');
    expect(result.utterances[0].text).toBe('google heard this');
    expect(result.utterances[0].speaker).toBeUndefined();
  });

  it('--type speech skips the speaker query entirely', async () => {
    const stubs = transcriptStubs({
      mediaClips: [compositeMediaClip],
      speakerRows: [speakerRow],
      speechRows: [speechRow],
    });
    const pb = fakePb(stubs);

    const result = await mediaClipTranscript(pb, 'mc1', { type: 'speech' });

    expect(stubs.LabelSpeaker.getList).not.toHaveBeenCalled();
    expect(result.labelType).toBe('speech');
    expect(result.labelTypeSelected).toBe('forced');
  });

  it('reports labelType null when nothing overlaps', async () => {
    const pb = fakePb(transcriptStubs({ mediaClips: [compositeMediaClip] }));
    const result = await mediaClipTranscript(pb, 'mc1');
    expect(result.labelType).toBeNull();
    expect(result.utterances).toEqual([]);
    expect(result.text).toBe('');
  });

  it('includes word arrays only with the words option', async () => {
    const pb = fakePb(
      transcriptStubs({
        mediaClips: [compositeMediaClip],
        speakerRows: [speakerRow],
      })
    );
    const result = await mediaClipTranscript(pb, 'mc1', { words: true });
    expect(result.utterances[0].parts[0].words).toHaveLength(2);
  });
});

describe('timelineClipTranscript', () => {
  // Placed at 30; 1-segment meta mask [2,6] over the composite MediaClip.
  const maskedClip = {
    id: 'tc1',
    TimelineRef: 'tl1',
    TimelineTrackRef: 'trk0',
    MediaRef: 'm1',
    MediaClipRef: 'mc1',
    order: 0,
    start: 0,
    end: 60,
    duration: 4,
    timelineStart: 30,
    meta: { segments: [{ start: 2, end: 6 }] },
    expand: {
      MediaClipRef: compositeMediaClip,
    },
  };

  it('uses the meta mask and projects timeline times', async () => {
    const pb = fakePb(
      transcriptStubs({
        timelineClips: [maskedClip],
        speakerRows: [
          {
            ...speakerRow,
            start: 3,
            end: 9,
            words: [
              { text: 'inside', start: 3, end: 4 },
              { text: 'outside', start: 8, end: 9 },
            ],
          },
        ],
      })
    );

    const result = await timelineClipTranscript(pb, 'tc1', {
      timelineId: 'tl1',
    });

    expect(result.editListSource).toBe('meta');
    expect(result.segments).toEqual([{ start: 2, end: 6 }]);
    expect(result.placement).toEqual({
      timelineId: 'tl1',
      layer: 0,
      timelineStart: 30,
      timelineEnd: 34,
    });
    const u = result.utterances[0];
    // Only the masked range's text survives; "outside" (8-9s) is masked out.
    expect(u.text).toBe('inside');
    expect(u.omittedWords).toBe(1);
    // timeline = placement.timelineStart + clip offset (3-2=1 .. 4-2=2)
    expect(u.timelineStart).toBe(31);
    expect(u.timelineEnd).toBe(32);
    expect(u.parts[0].timelineStart).toBe(31);
    expect(u.parts[0].timelineEnd).toBe(32);
  });

  it('rejects caption clips and validates -t', async () => {
    const caption = {
      id: 'cap1',
      TimelineRef: 'tl1',
      CaptionRef: 'c1',
      order: 0,
      start: 0,
      end: 4,
    };
    const pb = fakePb(transcriptStubs({ timelineClips: [caption] }));
    await expect(timelineClipTranscript(pb, 'cap1')).rejects.toThrow(
      /no source media/i
    );

    const pb2 = fakePb(transcriptStubs({ timelineClips: [maskedClip] }));
    await expect(
      timelineClipTranscript(pb2, 'tc1', { timelineId: 'other' })
    ).rejects.toThrow(/belongs to timeline tl1/i);
  });
});
