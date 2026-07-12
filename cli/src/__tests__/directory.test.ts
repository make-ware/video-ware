import { describe, expect, it, vi } from 'vitest';
import type { Directory } from '@project/shared';
import {
  directoryPaths,
  listDirectories,
  resolveDirectory,
} from '../lib/directory.js';
import { fakePb, listResult } from './fake-pb.js';

const notFound = () => Object.assign(new Error('not found'), { status: 404 });

const dir = (id: string, name: string, parent?: string): Directory =>
  ({
    id,
    name,
    WorkspaceRef: 'ws1',
    ParentDirectoryRef: parent ?? '',
  }) as Directory;

describe('directoryPaths', () => {
  it('uses the plain name for root directories', () => {
    const paths = directoryPaths([
      dir('d1', 'Hawaii'),
      dir('d2', 'Costa Rica'),
    ]);
    expect(paths.get('d1')).toBe('Hawaii');
    expect(paths.get('d2')).toBe('Costa Rica');
  });

  it('prefixes nested directories with their ancestor chain', () => {
    const paths = directoryPaths([
      dir('d1', 'Hawaii'),
      dir('d2', 'Maui', 'd1'),
      dir('d3', 'Snorkeling', 'd2'),
    ]);
    expect(paths.get('d2')).toBe('Hawaii/Maui');
    expect(paths.get('d3')).toBe('Hawaii/Maui/Snorkeling');
  });

  it('truncates at a missing parent or a cycle instead of failing', () => {
    const paths = directoryPaths([
      dir('d1', 'Orphan', 'gone'),
      dir('d2', 'A', 'd3'),
      dir('d3', 'B', 'd2'),
    ]);
    expect(paths.get('d1')).toBe('Orphan');
    expect(paths.get('d2')).toBe('B/A');
    expect(paths.get('d3')).toBe('A/B');
  });
});

describe('listDirectories', () => {
  it('lists the workspace directories with a bound filter', async () => {
    const getList = vi.fn(
      async (_page: number, _perPage: number, opts: { filter?: string }) => {
        expect(opts.filter).toBe('WorkspaceRef = ws1');
        return listResult([dir('d1', 'Hawaii')]);
      }
    );
    const pb = fakePb({ Directories: { getList } });

    const result = await listDirectories(pb, 'ws1');

    expect(getList).toHaveBeenCalledOnce();
    expect(result.items).toHaveLength(1);
  });
});

describe('resolveDirectory', () => {
  it('resolves by record id when it belongs to the workspace', async () => {
    const pb = fakePb({
      Directories: { getOne: vi.fn(async () => dir('d1', 'Hawaii')) },
    });

    const found = await resolveDirectory(pb, 'ws1', 'd1');
    expect(found.id).toBe('d1');
  });

  it('falls back to an exact name match in the workspace', async () => {
    const getFirstListItem = vi.fn(async (filter: string) => {
      expect(filter).toContain('WorkspaceRef = ws1');
      expect(filter).toContain('name = Hawaii');
      return dir('d1', 'Hawaii');
    });
    const pb = fakePb({
      Directories: {
        getOne: vi.fn().mockRejectedValue(notFound()),
        getFirstListItem,
      },
    });

    const found = await resolveDirectory(pb, 'ws1', 'Hawaii');
    expect(found.id).toBe('d1');
  });

  it('accepts a single unambiguous fuzzy match', async () => {
    const pb = fakePb({
      Directories: {
        getOne: vi.fn().mockRejectedValue(notFound()),
        getFirstListItem: vi.fn().mockRejectedValue(notFound()),
        getList: vi.fn(async () => listResult([dir('d1', 'Hawaii 2024')])),
      },
    });

    const found = await resolveDirectory(pb, 'ws1', 'hawaii');
    expect(found.id).toBe('d1');
  });

  it('rejects an ambiguous fuzzy match with the candidates', async () => {
    const pb = fakePb({
      Directories: {
        getOne: vi.fn().mockRejectedValue(notFound()),
        getFirstListItem: vi.fn().mockRejectedValue(notFound()),
        getList: vi.fn(async () =>
          listResult([dir('d1', 'Hawaii 2024'), dir('d2', 'Hawaii 2025')])
        ),
      },
    });

    await expect(resolveDirectory(pb, 'ws1', 'hawaii')).rejects.toThrow(
      /ambiguous.*Hawaii 2024.*Hawaii 2025/i
    );
  });

  it('rejects an id from another workspace and an unknown name', async () => {
    const pb = fakePb({
      Directories: {
        getOne: vi.fn(async () => ({
          ...dir('d9', 'Other'),
          WorkspaceRef: 'ws2',
        })),
        getFirstListItem: vi.fn().mockRejectedValue(notFound()),
        getList: vi.fn(async () => listResult([])),
      },
    });

    await expect(resolveDirectory(pb, 'ws1', 'd9')).rejects.toThrow(
      /no directory matching/i
    );
  });
});
