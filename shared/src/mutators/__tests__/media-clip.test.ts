import { describe, expect, it, vi } from 'vitest';
import { MediaClipMutator, type ActualizableLabel } from '../media-clip';
import { ClipType, LabelType } from '../../enums';
import type { TypedPocketBase } from '../../types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Stub = Record<string, any>;

function fakePb(collections: Record<string, Stub>): TypedPocketBase {
  return {
    authStore: { record: { id: 'user1' }, token: 'tok' },
    autoCancellation: () => {},
    // Echo a deterministic, already-substituted filter string for assertions.
    filter: (tpl: string, params: Record<string, unknown>) =>
      Object.entries(params).reduce(
        (acc, [k, v]) => acc.replaceAll(`{:${k}}`, String(v)),
        tpl
      ),
    collection: (name: string) => {
      const c = collections[name];
      if (!c) throw new Error(`unexpected collection: ${name}`);
      return c;
    },
  } as unknown as TypedPocketBase;
}

const notFound = () => Object.assign(new Error('not found'), { status: 404 });

function clipCollections() {
  return {
    MediaClips: {
      create: vi.fn(async (data: object) => ({ ...data, id: 'clip1' })),
    },
    MediaClipLabels: {
      getFirstListItem: vi.fn().mockRejectedValue(notFound()),
      create: vi.fn(async (data: object) => ({ ...data, id: 'link1' })),
    },
  };
}

const baseLabel = {
  id: 'label1',
  WorkspaceRef: 'ws1',
  MediaRef: 'm1',
  start: 5,
  end: 9,
  duration: 4,
} as unknown as ActualizableLabel;

describe('createFromLabel', () => {
  it('creates the clip and then the MediaClipLabels provenance row', async () => {
    const collections = clipCollections();
    const pb = fakePb(collections);
    const label = { ...baseLabel, avgConfidence: 0.82, version: 2 };

    const clip = await new MediaClipMutator(pb).createFromLabel(
      label as ActualizableLabel,
      LabelType.FACE,
      'inspector'
    );

    expect(clip.id).toBe('clip1');
    expect(collections.MediaClips.create.mock.calls[0][0]).toMatchObject({
      WorkspaceRef: 'ws1',
      MediaRef: 'm1',
      type: ClipType.FACE,
      start: 5,
      end: 9,
      duration: 4,
      version: 2,
      processor: 'inspector',
      clipData: {
        sourceId: 'label1',
        sourceType: 'label',
        labelType: LabelType.FACE,
        confidence: 0.82,
      },
    });
    expect(collections.MediaClipLabels.create.mock.calls[0][0]).toMatchObject({
      WorkspaceRef: 'ws1',
      MediaClipRef: 'clip1',
      labelType: LabelType.FACE,
      LabelFaceRef: 'label1',
      confidence: 0.82,
    });
  });

  it('maps SPEECH to a speech clip and SEGMENT to a range clip', async () => {
    for (const [labelType, clipType, refField] of [
      [LabelType.SPEECH, ClipType.SPEECH, 'LabelSpeechRef'],
      [LabelType.SEGMENT, ClipType.RANGE, 'LabelSegmentRef'],
    ] as const) {
      const collections = clipCollections();
      const pb = fakePb(collections);
      const label = { ...baseLabel, confidence: 0.5 };

      await new MediaClipMutator(pb).createFromLabel(
        label as ActualizableLabel,
        labelType,
        'cli'
      );

      expect(collections.MediaClips.create.mock.calls[0][0]).toMatchObject({
        type: clipType,
      });
      expect(collections.MediaClipLabels.create.mock.calls[0][0]).toMatchObject(
        { labelType, [refField]: 'label1' }
      );
    }
  });

  it('rethrows a link failure with the created clip id for context', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const collections = clipCollections();
    collections.MediaClipLabels.create = vi
      .fn()
      .mockRejectedValue(new Error('boom'));
    const pb = fakePb(collections);
    const label = { ...baseLabel, confidence: 0.5 };

    await expect(
      new MediaClipMutator(pb).createFromLabel(
        label as ActualizableLabel,
        LabelType.SHOT,
        'cli'
      )
    ).rejects.toThrow(/clip clip1 created but provenance link failed: boom/i);
    vi.restoreAllMocks();
  });
});
