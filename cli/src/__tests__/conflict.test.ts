import { describe, expect, it, vi } from 'vitest';
import { RecordConflictError } from '@project/shared';
import { withConflictRetry } from '../lib/conflict.js';
import type { OpWarning } from '../lib/warnings.js';

const conflict = (changedFields: string[]) =>
  new RecordConflictError({
    collection: 'TimelineClips',
    recordId: 'tc1',
    expectedUpdated: 'T1',
    actualUpdated: 'T2',
    changedFields,
  });

const okResult = (): { warnings: OpWarning[] } => ({ warnings: [] });

describe('withConflictRetry', () => {
  it('passes a clean run straight through', async () => {
    const run = vi.fn(async () => okResult());
    await withConflictRetry(run, { patchKeys: ['timelineStart'] });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('rethrows non-conflict errors untouched', async () => {
    const boom = new Error('boom');
    const run = vi.fn(async () => {
      throw boom;
    });
    await expect(withConflictRetry(run, { patchKeys: [] })).rejects.toThrow(
      boom
    );
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('retries once when the remote change touched disjoint fields', async () => {
    const run = vi
      .fn<() => Promise<{ warnings: OpWarning[] }>>()
      .mockRejectedValueOnce(conflict(['label']))
      .mockResolvedValue(okResult());
    const infoSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await withConflictRetry(run, {
      patchKeys: ['timelineStart'],
    });

    expect(run).toHaveBeenCalledTimes(2);
    // the retry is tagged so --json consumers see it happened
    expect(result.warnings.map((w) => w.code)).toEqual(['stale-read']);
    infoSpy.mockRestore();
  });

  it('aborts when the remote change touched the same fields', async () => {
    const run = vi.fn(async () => {
      throw conflict(['timelineStart']);
    });
    await expect(
      withConflictRetry(run, { patchKeys: ['timelineStart'] })
    ).rejects.toThrow(/same field\(s\).*--force/s);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('always treats meta as contested (whole-JSON column)', async () => {
    const run = vi.fn(async () => {
      throw conflict(['meta']);
    });
    await expect(
      withConflictRetry(run, { patchKeys: ['timelineStart'] })
    ).rejects.toThrow(/meta/);
  });

  it('--force retries (re-planning on fresh state) despite contested fields', async () => {
    const run = vi
      .fn<() => Promise<{ warnings: OpWarning[] }>>()
      .mockRejectedValueOnce(conflict(['timelineStart']))
      .mockResolvedValue(okResult());
    const infoSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await withConflictRetry(run, {
      patchKeys: ['timelineStart'],
      force: true,
    });

    expect(run).toHaveBeenCalledTimes(2);
    expect(result.warnings.map((w) => w.code)).toEqual(['stale-read']);
    infoSpy.mockRestore();
  });

  it('propagates a second conflict as a hard error', async () => {
    const run = vi.fn(async () => {
      throw conflict(['label']);
    });
    const infoSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(
      withConflictRetry(run, { patchKeys: ['timelineStart'] })
    ).rejects.toThrow(RecordConflictError);
    expect(run).toHaveBeenCalledTimes(2);
    infoSpy.mockRestore();
  });
});
