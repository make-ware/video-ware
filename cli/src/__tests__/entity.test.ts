import { describe, expect, it, vi } from 'vitest';
import { EntityKind } from '@project/shared';
import {
  applyEntityLinks,
  formatEntityTranscript,
  getEntityAppearances,
  getEntityWords,
  parseEntityKind,
  resolveEntity,
  resolveLinkTargets,
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

  it('passes track and cluster ids through, deduped', async () => {
    const pb = fakePb({});
    await expect(
      resolveLinkTargets(pb, {
        track: ['t1', 't1', 't2'],
        cluster: ['le1'],
      })
    ).resolves.toEqual({ trackIds: ['t1', 't2'], clusterIds: ['le1'] });
  });

  it('resolves a type:labelId pair to the label row track', async () => {
    const pb = fakePb({
      LabelFaces: {
        getOne: vi.fn(async () => ({ id: 'lf1', LabelTrackRef: 't7' })),
      },
    });
    await expect(
      resolveLinkTargets(pb, { label: ['face:lf1'] })
    ).resolves.toEqual({ trackIds: ['t7'], clusterIds: [] });
  });

  it('rejects label rows without a track, pointing at --cluster', async () => {
    const pb = fakePb({
      LabelShots: { getOne: vi.fn(async () => ({ id: 'ls1' })) },
    });
    await expect(
      resolveLinkTargets(pb, { label: ['shot:ls1'] })
    ).rejects.toThrow(/--cluster/);
  });

  it('resolves --speaker mediaId:speakerId via the track lookup', async () => {
    const tracks = {
      getFirstListItem: vi.fn(async (_filter: string, _opts?: unknown) => ({
        id: 't9',
      })),
    };
    const pb = fakePb({ LabelTrack: tracks });
    await expect(
      resolveLinkTargets(pb, { speaker: 'm1:speaker_0' })
    ).resolves.toEqual({ trackIds: ['t9'], clusterIds: [] });
    const [filter] = tracks.getFirstListItem.mock.calls[0];
    expect(filter).toContain('MediaRef = m1');
    expect(filter).toContain('trackId = speaker_0');
  });

  it('rejects malformed pair arguments', async () => {
    const pb = fakePb({});
    await expect(
      resolveLinkTargets(pb, { speaker: 'no-colon' })
    ).rejects.toThrow(/expects <mediaId>:<providerId>/);
  });
});

describe('applyEntityLinks', () => {
  it('points tracks and clusters at the entity', async () => {
    const tracks = { update: vi.fn(async (id: string) => ({ id })) };
    const clusters = { update: vi.fn(async (id: string) => ({ id })) };
    const pb = fakePb({ LabelTrack: tracks, LabelEntity: clusters });

    const written = await applyEntityLinks(pb, 'e1', {
      trackIds: ['t1', 't2'],
      clusterIds: ['le1'],
    });

    expect(written.tracks).toHaveLength(2);
    expect(tracks.update).toHaveBeenCalledWith(
      't1',
      { EntityRef: 'e1' },
      expect.anything()
    );
    expect(clusters.update).toHaveBeenCalledWith(
      'le1',
      { EntityRef: 'e1' },
      expect.anything()
    );
  });

  it('clears links when the entity is null', async () => {
    const tracks = { update: vi.fn(async (id: string) => ({ id })) };
    const pb = fakePb({ LabelTrack: tracks });

    await applyEntityLinks(pb, null, { trackIds: ['t1'], clusterIds: [] });

    expect(tracks.update).toHaveBeenCalledWith(
      't1',
      { EntityRef: '' },
      expect.anything()
    );
  });
});

describe('getEntityWords', () => {
  it('queries speaker rows with the track-precedence attribution filter', async () => {
    const speakers = listStub([{ id: 's1', MediaRef: 'm1', transcript: 'hi' }]);
    const pb = fakePb({ LabelSpeaker: speakers });

    const { utterances } = await getEntityWords(pb, 'e1', { media: 'm1' });

    expect(utterances).toHaveLength(1);
    const [, , options] = speakers.getList.mock.calls[0];
    expect(options.filter).toContain('LabelTrackRef.EntityRef = "e1"');
    expect(options.filter).toContain(
      'LabelTrackRef.EntityRef = "" && LabelEntityRef.EntityRef = "e1"'
    );
    expect(options.filter).toContain('MediaRef = m1');
    expect(options.sort).toBe('MediaRef,start');
    expect(options.expand).toBe('MediaRef.UploadRef');
  });
});

describe('getEntityAppearances', () => {
  it('marks direct track links vs inherited cluster links', async () => {
    const tracks = listStub([
      {
        id: 't1',
        MediaRef: 'm1',
        trackId: '0',
        EntityRef: 'e1',
        start: 0,
        end: 2,
        duration: 2,
        expand: { LabelEntityRef: { labelType: 'face' } },
      },
      {
        id: 't2',
        MediaRef: 'm2',
        trackId: 'speaker_0',
        EntityRef: '',
        start: 1,
        end: 4,
        duration: 3,
        expand: { LabelEntityRef: { labelType: 'speaker' } },
      },
    ]);
    const pb = fakePb({ LabelTrack: tracks });

    const { appearances } = await getEntityAppearances(pb, 'e1');

    expect(appearances.map((a) => a.via)).toEqual(['track', 'cluster']);
    expect(appearances.map((a) => a.labelType)).toEqual(['face', 'speaker']);
    const [, , options] = tracks.getList.mock.calls[0];
    expect(options.filter).toContain('EntityRef = "e1"');
    expect(options.filter).toContain(
      'EntityRef = "" && LabelEntityRef.EntityRef = "e1"'
    );
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
