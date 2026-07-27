import { describe, expect, it, vi } from 'vitest';
import { EntityKind, LabelType } from '@project/shared';
import {
  applyEntityLinks,
  formatEntityTranscript,
  getEntityAppearances,
  getEntityLabels,
  getEntityWords,
  parseEntityKind,
  resolveEntity,
  resolveLinkTargets,
  tagLabel,
} from '../lib/entity.js';
import { fakePb, listResult, type Stub } from './fake-pb.js';

const notFound = () => Object.assign(new Error('not found'), { status: 404 });

const erik = {
  id: 'e1',
  WorkspaceRef: 'ws1',
  name: 'Erik',
  kind: 'person',
};

/** Entities collection stub: id lookup, exact-name lookup, fuzzy search. */
function entitiesStub({
  byId = null,
  byName = null,
  search = [],
}: {
  byId?: unknown;
  byName?: unknown;
  search?: unknown[];
} = {}): Stub {
  return {
    getOne: vi.fn(async (_id: string) => {
      if (byId) return byId;
      throw notFound();
    }),
    getFirstListItem: vi.fn(async (_filter: string, _opts?: unknown) => {
      if (byName) return byName;
      throw notFound();
    }),
    getList: vi.fn(async () => listResult(search)),
  };
}

/** getList stub capturing (page, perPage, options) like the real service. */
function listStub(items: unknown[]) {
  return {
    getList: vi.fn(
      async (
        _page: number,
        _perPage: number,
        _options: { filter?: string; sort?: string; expand?: string }
      ) => listResult(items)
    ),
  };
}

describe('parseEntityKind', () => {
  it('accepts a valid kind', () => {
    expect(parseEntityKind('product')).toBe(EntityKind.PRODUCT);
  });

  it('rejects an unknown kind', () => {
    expect(() => parseEntityKind('robot')).toThrow(/invalid entity kind/i);
  });
});

describe('resolveEntity', () => {
  it('resolves by record id when it belongs to the workspace', async () => {
    const pb = fakePb({ Entities: entitiesStub({ byId: erik }) });
    await expect(resolveEntity(pb, 'ws1', 'e1')).resolves.toEqual(erik);
  });

  it('falls back to exact name', async () => {
    const entities = entitiesStub({ byName: erik });
    const pb = fakePb({ Entities: entities });
    await expect(resolveEntity(pb, 'ws1', 'Erik')).resolves.toEqual(erik);
    const [filter] = entities.getFirstListItem.mock.calls[0];
    expect(filter).toContain('WorkspaceRef = ws1');
    expect(filter).toContain('name = Erik');
  });

  it('accepts a single fuzzy match', async () => {
    const pb = fakePb({ Entities: entitiesStub({ search: [erik] }) });
    await expect(resolveEntity(pb, 'ws1', 'eri')).resolves.toEqual(erik);
  });

  it('rejects ambiguous fuzzy matches with candidates', async () => {
    const pb = fakePb({
      Entities: entitiesStub({
        search: [erik, { ...erik, id: 'e2', name: 'Erika' }],
      }),
    });
    await expect(resolveEntity(pb, 'ws1', 'eri')).rejects.toThrow(/ambiguous/i);
  });

  it('rejects unknown entities', async () => {
    const pb = fakePb({ Entities: entitiesStub() });
    await expect(resolveEntity(pb, 'ws1', 'nobody')).rejects.toThrow(
      /no entity matching/i
    );
  });
});

describe('resolveLinkTargets', () => {
  it('requires at least one target', async () => {
    const pb = fakePb({});
    await expect(resolveLinkTargets(pb, {})).rejects.toThrow(
      /at least one target/i
    );
  });

  it('passes LabelEntity ids through, deduped', async () => {
    const pb = fakePb({});
    await expect(
      resolveLinkTargets(pb, { cluster: ['le1', 'le1', 'le2'] })
    ).resolves.toEqual({ labelEntityIds: ['le1', 'le2'] });
  });

  // --track is addressed by track, but the link lands on the track's
  // LabelEntity: LabelTrack.EntityRef is retired and writing it is a no-op.
  it('resolves --track through the track LabelEntity', async () => {
    const tracks = {
      getOne: vi.fn(async (id: string) => ({ id, LabelEntityRef: 'le9' })),
    };
    const pb = fakePb({ LabelTrack: tracks });

    await expect(resolveLinkTargets(pb, { track: ['t1'] })).resolves.toEqual({
      labelEntityIds: ['le9'],
    });
    expect(tracks.getOne).toHaveBeenCalledWith('t1', expect.anything());
  });

  it('rejects a track with no LabelEntity rather than writing nothing', async () => {
    const pb = fakePb({
      LabelTrack: { getOne: vi.fn(async (id: string) => ({ id })) },
    });
    await expect(resolveLinkTargets(pb, { track: ['t1'] })).rejects.toThrow(
      /has no LabelEntity/i
    );
  });

  it('resolves a type:labelId pair to the label row LabelEntity', async () => {
    const pb = fakePb({
      LabelFaces: {
        getOne: vi.fn(async () => ({ id: 'lf1', LabelEntityRef: 'le7' })),
      },
    });
    await expect(
      resolveLinkTargets(pb, { label: ['face:lf1'] })
    ).resolves.toEqual({ labelEntityIds: ['le7'] });
  });

  // Shots have no LabelTrackRef; under the old track-first resolution they
  // were rejected outright, and now take the same path as everything else.
  it('resolves trackless label types through the same path', async () => {
    const pb = fakePb({
      LabelShots: {
        getOne: vi.fn(async () => ({ id: 'ls1', LabelEntityRef: 'le3' })),
      },
    });
    await expect(
      resolveLinkTargets(pb, { label: ['shot:ls1'] })
    ).resolves.toEqual({ labelEntityIds: ['le3'] });
  });

  it('resolves --speaker mediaId:speakerId to that media instance', async () => {
    const labelEntities = {
      getFirstListItem: vi.fn(async (_filter: string, _opts?: unknown) => ({
        id: 'le4',
      })),
    };
    const pb = fakePb({ LabelEntity: labelEntities });

    await expect(
      resolveLinkTargets(pb, { speaker: 'm1:speaker_0' })
    ).resolves.toEqual({ labelEntityIds: ['le4'] });

    const [filter] = labelEntities.getFirstListItem.mock.calls[0];
    expect(filter).toContain('MediaRef = m1');
    expect(filter).toContain('instanceId = speaker_0');
    // The type is part of the lookup, so --face m1:0 can't land on the
    // object track that shares provider id "0".
    expect(filter).toContain('labelType = speaker');
  });

  it('reports an unknown instance with a listing hint', async () => {
    const pb = fakePb({
      LabelEntity: {
        getFirstListItem: vi.fn(async () => {
          throw notFound();
        }),
      },
    });
    await expect(resolveLinkTargets(pb, { face: 'm1:7' })).rejects.toThrow(
      /No face "7" in media m1/
    );
  });

  it('rejects malformed pair arguments', async () => {
    const pb = fakePb({});
    await expect(
      resolveLinkTargets(pb, { speaker: 'no-colon' })
    ).rejects.toThrow(/expects <mediaId>:<providerId>/);
  });
});

describe('applyEntityLinks', () => {
  it('writes the link on every resolved LabelEntity', async () => {
    const labelEntities = {
      update: vi.fn(async (id: string, data: object) => ({ id, ...data })),
    };
    const pb = fakePb({ LabelEntity: labelEntities });

    const written = await applyEntityLinks(pb, 'e1', {
      labelEntityIds: ['le1', 'le2'],
    });

    expect(written).toHaveLength(2);
    expect(labelEntities.update).toHaveBeenCalledWith(
      'le1',
      { EntityRef: 'e1' },
      expect.anything()
    );
    expect(labelEntities.update).toHaveBeenCalledWith(
      'le2',
      { EntityRef: 'e1' },
      expect.anything()
    );
  });

  it('clears links when the entity is null', async () => {
    const labelEntities = {
      update: vi.fn(async (id: string, data: object) => ({ id, ...data })),
    };
    const pb = fakePb({ LabelEntity: labelEntities });

    await applyEntityLinks(pb, null, { labelEntityIds: ['le1'] });

    expect(labelEntities.update).toHaveBeenCalledWith(
      'le1',
      { EntityRef: '' },
      expect.anything()
    );
  });

  // The regression the retired field caused: a link reported success while
  // LabelTrack.EntityRef, which nothing reads, was the only thing written.
  it('never writes LabelTrack', async () => {
    const tracks = {
      getOne: vi.fn(async (id: string) => ({ id, LabelEntityRef: 'le5' })),
      update: vi.fn(),
    };
    const labelEntities = {
      update: vi.fn(async (id: string, data: object) => ({ id, ...data })),
    };
    const pb = fakePb({ LabelTrack: tracks, LabelEntity: labelEntities });

    const targets = await resolveLinkTargets(pb, { track: ['t1'] });
    await applyEntityLinks(pb, 'e1', targets);

    expect(tracks.update).not.toHaveBeenCalled();
    expect(labelEntities.update).toHaveBeenCalledWith(
      'le5',
      { EntityRef: 'e1' },
      expect.anything()
    );
  });
});

describe('tagLabel', () => {
  it('writes the link on the row LabelEntity', async () => {
    const labelEntities = {
      update: vi.fn(async (id: string, data: object) => ({
        id,
        canonicalName: 'Speaker 1',
        ...data,
      })),
    };
    const pb = fakePb({
      LabelSpeaker: {
        getOne: vi.fn(async () => ({ id: 'sk1', LabelEntityRef: 'le7' })),
      },
      LabelEntity: labelEntities,
    });

    const result = await tagLabel(pb, LabelType.SPEAKER, 'sk1', 'e1');

    expect(labelEntities.update).toHaveBeenCalledWith(
      'le7',
      { EntityRef: 'e1' },
      expect.anything()
    );
    expect(result).toMatchObject({
      targetId: 'le7',
      targetName: 'Speaker 1',
    });
  });

  // Shots and segments have no LabelTrackRef at all. Under the old
  // track-first routing they could only be tagged through a separate cluster
  // fallback; now they take the identical path as everything else.
  it('tags trackless types through the same path', async () => {
    const labelEntities = {
      update: vi.fn(async (id: string, data: object) => ({
        id,
        canonicalName: 'Interview',
        ...data,
      })),
    };
    const pb = fakePb({
      LabelShots: {
        getOne: vi.fn(async () => ({ id: 'sh1', LabelEntityRef: 'le3' })),
      },
      LabelEntity: labelEntities,
    });

    const result = await tagLabel(pb, LabelType.SHOT, 'sh1', 'e1');

    expect(labelEntities.update).toHaveBeenCalledWith(
      'le3',
      { EntityRef: 'e1' },
      expect.anything()
    );
    expect(result).toMatchObject({
      targetId: 'le3',
      targetName: 'Interview',
    });
  });

  it('clears the link when untagging (entity null)', async () => {
    const labelEntities = {
      update: vi.fn(async (id: string, data: object) => ({
        id,
        canonicalName: 'Face',
        ...data,
      })),
    };
    const pb = fakePb({
      LabelFaces: {
        getOne: vi.fn(async () => ({ id: 'lf1', LabelEntityRef: 'le2' })),
      },
      LabelEntity: labelEntities,
    });

    await tagLabel(pb, LabelType.FACE, 'lf1', null);

    expect(labelEntities.update).toHaveBeenCalledWith(
      'le2',
      { EntityRef: '' },
      expect.anything()
    );
  });

  it('rejects labels with no LabelEntity', async () => {
    const pb = fakePb({
      LabelText: { getOne: vi.fn(async () => ({ id: 'tx1' })) },
    });
    await expect(tagLabel(pb, LabelType.TEXT, 'tx1', 'e1')).rejects.toThrow(
      /has no LabelEntity/i
    );
  });

  it('reports a not-found label with a type-mismatch hint', async () => {
    const pb = fakePb({
      LabelSpeaker: { getOne: vi.fn().mockRejectedValue(notFound()) },
    });
    await expect(tagLabel(pb, LabelType.SPEAKER, 'nope', 'e1')).rejects.toThrow(
      /no speaker label with id nope/i
    );
  });
});

describe('getEntityLabels', () => {
  it('fans out per type with one uniform attribution filter', async () => {
    const speakers = listStub([
      { id: 'sk1', MediaRef: 'm2', start: 5 },
      { id: 'sk2', MediaRef: 'm1', start: 3 },
    ]);
    const shots = listStub([{ id: 'sh1', MediaRef: 'm1', start: 0 }]);
    const pb = fakePb({ LabelSpeaker: speakers, LabelShots: shots });

    const { hits, totalItems } = await getEntityLabels(pb, 'e1', {
      types: [LabelType.SPEAKER, LabelType.SHOT],
    });

    // Track-bearing and trackless types now get the identical filter and
    // expand — the per-type dispatch is gone.
    const speakerOptions = speakers.getList.mock.calls[0][2];
    expect(speakerOptions.filter).toContain('LabelEntityRef.EntityRef = "e1"');
    expect(speakerOptions.sort).toBe('MediaRef,start');
    expect(speakerOptions.expand).toBe(
      'MediaRef.UploadRef,LabelEntityRef.EntityRef'
    );

    const shotOptions = shots.getList.mock.calls[0][2];
    expect(shotOptions.filter).toBe(speakerOptions.filter);
    expect(shotOptions.filter).not.toContain('LabelTrackRef');

    // Merged hits are ordered by media, then start.
    expect(hits.map((h) => h.record.id)).toEqual(['sh1', 'sk2', 'sk1']);
    expect(totalItems).toBe(3);
  });

  it('restricts to one media when asked', async () => {
    const speakers = listStub([]);
    const pb = fakePb({ LabelSpeaker: speakers });

    await getEntityLabels(pb, 'e1', {
      types: [LabelType.SPEAKER],
      media: 'm1',
    });

    expect(speakers.getList.mock.calls[0][2].filter).toContain('MediaRef = m1');
  });
});

describe('getEntityWords', () => {
  it('queries speaker rows with the single-hop attribution filter', async () => {
    const speakers = listStub([{ id: 's1', MediaRef: 'm1', transcript: 'hi' }]);
    const pb = fakePb({ LabelSpeaker: speakers });

    const { utterances } = await getEntityWords(pb, 'e1', { media: 'm1' });

    expect(utterances).toHaveLength(1);
    const [, , options] = speakers.getList.mock.calls[0];
    expect(options.filter).toContain('LabelEntityRef.EntityRef = "e1"');
    expect(options.filter).not.toContain('LabelTrackRef');
    expect(options.filter).toContain('MediaRef = m1');
    expect(options.sort).toBe('MediaRef,start');
    expect(options.expand).toBe('MediaRef.UploadRef');
  });
});

describe('getEntityAppearances', () => {
  it('returns one appearance per attributed track', async () => {
    const tracks = listStub([
      {
        id: 't1',
        MediaRef: 'm1',
        trackId: '0',
        start: 0,
        end: 2,
        duration: 2,
        expand: { LabelEntityRef: { labelType: 'face', EntityRef: 'e1' } },
      },
      {
        id: 't2',
        MediaRef: 'm2',
        trackId: 'speaker_0',
        start: 1,
        end: 4,
        duration: 3,
        expand: { LabelEntityRef: { labelType: 'speaker', EntityRef: 'e1' } },
      },
    ]);
    const pb = fakePb({ LabelTrack: tracks });

    const { appearances } = await getEntityAppearances(pb, 'e1');

    expect(appearances.map((a) => a.track.id)).toEqual(['t1', 't2']);
    expect(appearances.map((a) => a.labelType)).toEqual(['face', 'speaker']);
    // LabelTrack resolves through its own LabelEntity like every other row.
    const [, , options] = tracks.getList.mock.calls[0];
    expect(options.filter).toContain('LabelEntityRef.EntityRef = "e1"');
  });
});

describe('formatEntityTranscript', () => {
  it('groups utterances under one header per media', () => {
    const text = formatEntityTranscript([
      { MediaRef: 'm1', transcript: 'hello' },
      { MediaRef: 'm1', transcript: 'world' },
      { MediaRef: 'm2', transcript: 'again' },
    ] as never);
    expect(text).toBe('== m1 ==\n\nhello\n\nworld\n\n== m2 ==\n\nagain');
  });
});
