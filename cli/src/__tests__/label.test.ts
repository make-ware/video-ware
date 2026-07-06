import { describe, expect, it, vi } from 'vitest';
import { ClipType, LabelType } from '@project/shared';
import {
  createClipFromLabel,
  getLabel,
  listLabels,
  parseLabelType,
  parseLabelTypes,
  searchLabels,
} from '../lib/label.js';
import { fakePb, listResult, type Stub } from './fake-pb.js';

/** getList stub returning the given items for every query. */
function listStub(items: unknown[] = []) {
  return {
    getList: vi.fn(
      async (
        _page: number,
        _perPage: number,
        _opts: { filter?: string; sort?: string; expand?: string }
      ) => listResult(items)
    ),
  };
}

/** Empty stubs for all 8 label collections (override per test). */
function allLabelCollections(overrides: Record<string, Stub> = {}) {
  return {
    LabelObjects: listStub(),
    LabelShots: listStub(),
    LabelPerson: listStub(),
    LabelSpeech: listStub(),
    LabelSpeaker: listStub(),
    LabelFaces: listStub(),
    LabelSegments: listStub(),
    LabelText: listStub(),
    ...overrides,
  };
}

const notFound = () => Object.assign(new Error('not found'), { status: 404 });

describe('parseLabelType', () => {
  it('accepts a valid label type', () => {
    expect(parseLabelType('speech')).toBe(LabelType.SPEECH);
  });

  it('rejects an unknown label type', () => {
    expect(() => parseLabelType('bogus')).toThrow(/invalid label type/i);
  });

  it('parses a comma-separated list', () => {
    expect(parseLabelTypes('face, object')).toEqual([
      LabelType.FACE,
      LabelType.OBJECT,
    ]);
  });
});

describe('searchLabels', () => {
  it('searches speech transcripts with a bound workspace-scoped filter', async () => {
    const speech = listStub([
      { id: 'sp1', MediaRef: 'm1', start: 1, end: 2, confidence: 0.9 },
    ]);
    const pb = fakePb(allLabelCollections({ LabelSpeech: speech }));

    const { hits, totalItems } = await searchLabels(pb, {
      workspaceId: 'ws1',
      query: 'hello',
      types: [LabelType.SPEECH],
    });

    expect(speech.getList).toHaveBeenCalledOnce();
    const [page, perPage, options] = speech.getList.mock.calls[0];
    expect(page).toBe(1);
    expect(perPage).toBe(20);
    expect(options.filter).toContain('WorkspaceRef = ws1');
    expect(options.filter).toContain('transcript ~ hello');
    expect(options.sort).toBe('-confidence');
    expect(options.expand).toBe('MediaRef.UploadRef');
    expect(hits).toEqual([
      {
        type: LabelType.SPEECH,
        record: expect.objectContaining({ id: 'sp1' }),
      },
    ]);
    expect(totalItems).toBe(1);
  });

  it('searches speaker labels across transcript and speakerId', async () => {
    const speaker = listStub([
      {
        id: 'sk1',
        MediaRef: 'm1',
        speakerId: 'speaker_0',
        transcript: 'hello there',
        start: 0,
        end: 2,
        confidence: 0.95,
      },
    ]);
    const pb = fakePb(allLabelCollections({ LabelSpeaker: speaker }));

    const { hits } = await searchLabels(pb, {
      workspaceId: 'ws1',
      query: 'hello',
      types: [LabelType.SPEAKER],
    });

    expect(speaker.getList).toHaveBeenCalledOnce();
    const options = speaker.getList.mock.calls[0][2];
    expect(options.filter).toContain('transcript ~ hello');
    expect(options.filter).toContain('speakerId ~ hello');
    expect(hits[0].type).toBe(LabelType.SPEAKER);
  });

  it('matches faces by exact faceId with avgConfidence threshold and sort', async () => {
    const faces = listStub([
      { id: 'f1', MediaRef: 'm1', start: 0, end: 3, avgConfidence: 0.8 },
    ]);
    const pb = fakePb(allLabelCollections({ LabelFaces: faces }));

    const { hits } = await searchLabels(pb, {
      workspaceId: 'ws1',
      faceId: 'F1',
      minConfidence: 0.5,
    });

    // The id flag implies types = [face]: only LabelFaces is queried.
    expect(faces.getList).toHaveBeenCalledOnce();
    const options = faces.getList.mock.calls[0][2];
    expect(options.filter).toContain('faceId = F1');
    expect(options.filter).toContain('avgConfidence >= 0.5');
    expect(options.sort).toBe('-avgConfidence');
    expect(hits).toHaveLength(1);
    expect(hits[0].type).toBe(LabelType.FACE);
  });

  it('fans out to all label collections when no types are given', async () => {
    const collections = allLabelCollections();
    const pb = fakePb(collections);

    await searchLabels(pb, { workspaceId: 'ws1', query: 'sunset' });

    for (const stub of Object.values(collections)) {
      expect(stub.getList).toHaveBeenCalledOnce();
    }
  });

  it('scopes to a single media when given', async () => {
    const speech = listStub();
    const pb = fakePb(allLabelCollections({ LabelSpeech: speech }));

    await searchLabels(pb, {
      workspaceId: 'ws1',
      query: 'hello',
      types: [LabelType.SPEECH],
      media: 'm1',
    });

    expect(speech.getList.mock.calls[0][2].filter).toContain('MediaRef = m1');
  });

  it('merges hits best-confidence-first across types', async () => {
    const pb = fakePb(
      allLabelCollections({
        LabelSpeech: listStub([{ id: 'sp1', confidence: 0.7 }]),
        LabelObjects: listStub([{ id: 'ob1', confidence: 0.95 }]),
      })
    );

    const { hits, totalItems } = await searchLabels(pb, {
      workspaceId: 'ws1',
      query: 'dog',
      types: [LabelType.SPEECH, LabelType.OBJECT],
    });

    expect(hits.map((h) => h.record.id)).toEqual(['ob1', 'sp1']);
    expect(totalItems).toBe(2);
  });

  it('requires a query or an exact-id flag', async () => {
    const pb = fakePb(allLabelCollections());
    await expect(searchLabels(pb, { workspaceId: 'ws1' })).rejects.toThrow(
      /query or an exact-id flag/i
    );
  });

  it('rejects an id flag conflicting with explicit --types', async () => {
    const pb = fakePb(allLabelCollections());
    await expect(
      searchLabels(pb, {
        workspaceId: 'ws1',
        faceId: 'F1',
        types: [LabelType.SPEECH],
      })
    ).rejects.toThrow(/conflicts with --face-id/i);
  });
});

describe('listLabels', () => {
  it('lists one media across the requested types sorted by start', async () => {
    const speech = listStub([{ id: 'sp1', start: 0 }]);
    const pb = fakePb(allLabelCollections({ LabelSpeech: speech }));

    const { hits } = await listLabels(pb, {
      mediaId: 'm1',
      types: [LabelType.SPEECH],
    });

    const [, perPage, options] = speech.getList.mock.calls[0];
    expect(perPage).toBe(100);
    expect(options.filter).toContain('MediaRef = m1');
    expect(options.sort).toBe('start');
    expect(hits).toHaveLength(1);
  });
});

describe('getLabel', () => {
  it('returns null when the label does not exist', async () => {
    const pb = fakePb({
      LabelSpeech: { getOne: vi.fn().mockRejectedValue(notFound()) },
    });
    expect(await getLabel(pb, LabelType.SPEECH, 'nope')).toBeNull();
  });
});

describe('createClipFromLabel', () => {
  const faceLabel = {
    id: 'face1',
    WorkspaceRef: 'ws1',
    MediaRef: 'm1',
    start: 12,
    end: 15.5,
    duration: 3.5,
    avgConfidence: 0.82,
    version: 2,
  };

  function clipCollections() {
    return {
      LabelFaces: { getOne: vi.fn(async () => faceLabel) },
      MediaClips: {
        create: vi.fn(async (data) => ({ ...data, id: 'clip1' })),
        update: vi.fn(async (_id, data) => ({ id: 'clip1', ...data })),
      },
      MediaClipLabels: {
        getFirstListItem: vi.fn().mockRejectedValue(notFound()),
        create: vi.fn(async (data) => ({ ...data, id: 'link1' })),
      },
    };
  }

  it('creates the clip and the MediaClipLabels provenance row', async () => {
    const collections = clipCollections();
    const pb = fakePb(collections);

    const { clip } = await createClipFromLabel(pb, {
      type: LabelType.FACE,
      labelId: 'face1',
    });

    expect(clip.id).toBe('clip1');
    expect(collections.MediaClips.create.mock.calls[0][0]).toMatchObject({
      WorkspaceRef: 'ws1',
      MediaRef: 'm1',
      type: ClipType.FACE,
      start: 12,
      end: 15.5,
      duration: 3.5,
      version: 2,
      processor: 'cli',
      clipData: {
        sourceId: 'face1',
        sourceType: 'label',
        labelType: LabelType.FACE,
        confidence: 0.82,
      },
    });
    expect(collections.MediaClipLabels.create.mock.calls[0][0]).toMatchObject({
      WorkspaceRef: 'ws1',
      MediaClipRef: 'clip1',
      labelType: LabelType.FACE,
      LabelFaceRef: 'face1',
      confidence: 0.82,
    });
    expect(collections.MediaClips.update).not.toHaveBeenCalled();
  });

  it('applies an optional clip label via update', async () => {
    const collections = clipCollections();
    const pb = fakePb(collections);

    const { clip } = await createClipFromLabel(pb, {
      type: LabelType.FACE,
      labelId: 'face1',
      label: 'hero face',
    });

    expect(collections.MediaClips.update).toHaveBeenCalledWith(
      'clip1',
      { label: 'hero face' },
      expect.anything()
    );
    expect(clip.label).toBe('hero face');
  });

  it('reports a not-found label with a type-mismatch hint', async () => {
    const pb = fakePb({
      LabelFaces: { getOne: vi.fn().mockRejectedValue(notFound()) },
    });

    await expect(
      createClipFromLabel(pb, { type: LabelType.FACE, labelId: 'nope' })
    ).rejects.toThrow(/no face label with id nope/i);
  });
});
