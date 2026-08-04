import { describe, it, expect, vi } from 'vitest';
import { healBoundingBox, type BoxedTrackRow } from '../track-bounding-box';

const box = { left: 0.1, top: 0.2, right: 0.3, bottom: 0.4 };

function mutator() {
  return {
    update: vi.fn(
      async (
        id: string,
        input: Partial<BoxedTrackRow>
      ): Promise<BoxedTrackRow> => ({ id, ...input })
    ),
  };
}

describe('healBoundingBox', () => {
  it('fills an empty box on a track written before the column was used', async () => {
    const m = mutator();
    const wrote = await healBoundingBox(m, { id: 'lt1' }, box);
    expect(wrote).toBe(true);
    expect(m.update).toHaveBeenCalledWith('lt1', { boundingBox: box });
  });

  it('treats null and a non-box object as empty', async () => {
    for (const stored of [null, undefined, '', {}, { left: 0.1 }]) {
      const m = mutator();
      await healBoundingBox(m, { id: 'lt1', boundingBox: stored }, box);
      expect(m.update).toHaveBeenCalledOnce();
    }
  });

  // A re-run finds its rows by content hash, so a stored box can only differ
  // by float noise — rewriting every row to chase that is pure churn.
  it('leaves an existing box alone, even a different one', async () => {
    const m = mutator();
    const different = { left: 0.9, top: 0.9, right: 0.95, bottom: 0.95 };
    const wrote = await healBoundingBox(
      m,
      { id: 'lt1', boundingBox: different },
      box
    );
    expect(wrote).toBe(false);
    expect(m.update).not.toHaveBeenCalled();
  });

  // Speech and speaker tracks have no geometry to heal with.
  it('writes nothing when this run computed no box', async () => {
    const m = mutator();
    const wrote = await healBoundingBox(m, { id: 'lt1' }, undefined);
    expect(wrote).toBe(false);
    expect(m.update).not.toHaveBeenCalled();
  });

  it('propagates a write failure to the caller-s insert loop', async () => {
    const m = {
      update: vi.fn(async () => {
        throw new Error('offline');
      }),
    };
    await expect(healBoundingBox(m, { id: 'lt1' }, box)).rejects.toThrow(
      'offline'
    );
  });
});
