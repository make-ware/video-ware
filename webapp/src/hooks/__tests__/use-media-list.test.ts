/**
 * Pure-function coverage for the media live list: the client-side filter
 * mirror (buildMediaMatches) and the sort descriptors whose comparators
 * must mirror their PocketBase sort strings with a total tiebreak.
 */
import { describe, it, expect } from 'vitest';
import type { MediaListItem } from '@/services/media';
import { buildMediaMatches } from '../use-media-list';
import {
  MEDIA_SORT_OPTIONS,
  getMediaSortOption,
  DEFAULT_MEDIA_SORT,
} from '@/components/media/media-sort';

const T0 = '2026-07-18 10:00:00.000Z';
const T1 = '2026-07-18 10:00:01.000Z';

function makeMedia(overrides: Partial<MediaListItem> = {}): MediaListItem {
  return {
    id: 'm1',
    WorkspaceRef: 'ws-1',
    DirectoryRef: '',
    mediaType: 'video',
    label: '',
    description: '',
    duration: 10,
    mediaDate: '',
    created: T0,
    updated: T0,
    expand: { UploadRef: { id: 'u1', name: 'clip.mp4' } },
    ...overrides,
  } as unknown as MediaListItem;
}

describe('buildMediaMatches', () => {
  const base = {
    workspaceId: 'ws-1',
    directoryId: null as string | null,
    mediaType: 'all',
    entityId: null as string | null,
    search: '',
  };

  it('requires the workspace to match', () => {
    const matches = buildMediaMatches(base);
    expect(matches(makeMedia())).toBe(true);
    expect(matches(makeMedia({ WorkspaceRef: 'ws-2' }))).toBe(false);
  });

  it('ignores directories when directoryId is null', () => {
    const matches = buildMediaMatches(base);
    expect(matches(makeMedia({ DirectoryRef: 'dir-1' }))).toBe(true);
  });

  it("matches the workspace root with directoryId ''", () => {
    const matches = buildMediaMatches({ ...base, directoryId: '' });
    expect(matches(makeMedia({ DirectoryRef: '' }))).toBe(true);
    expect(matches(makeMedia({ DirectoryRef: undefined } as never))).toBe(true);
    expect(matches(makeMedia({ DirectoryRef: 'dir-1' }))).toBe(false);
  });

  it('matches a specific directory', () => {
    const matches = buildMediaMatches({ ...base, directoryId: 'dir-1' });
    expect(matches(makeMedia({ DirectoryRef: 'dir-1' }))).toBe(true);
    expect(matches(makeMedia({ DirectoryRef: '' }))).toBe(false);
  });

  it('filters by media type', () => {
    const matches = buildMediaMatches({ ...base, mediaType: 'audio' });
    expect(matches(makeMedia({ mediaType: 'audio' } as never))).toBe(true);
    expect(matches(makeMedia({ mediaType: 'video' } as never))).toBe(false);
  });

  it('searches label, description, and upload name case-insensitively', () => {
    const matches = buildMediaMatches({ ...base, search: 'SUNSET' });
    expect(matches(makeMedia({ label: 'Beach sunset take 2' }))).toBe(true);
    expect(matches(makeMedia({ description: 'the sunset shot' }))).toBe(true);
    expect(
      matches(
        makeMedia({
          expand: { UploadRef: { id: 'u1', name: 'Sunset.mp4' } },
        } as never)
      )
    ).toBe(true);
    expect(matches(makeMedia())).toBe(false);
  });

  it('treats whitespace-only search as no search', () => {
    const matches = buildMediaMatches({ ...base, search: '   ' });
    expect(matches(makeMedia())).toBe(true);
  });

  it('filters by entity using the linked-media id set', () => {
    const matches = buildMediaMatches({
      ...base,
      entityId: 'e-1',
      entityLinkedIds: new Set(['m1']),
    });
    expect(matches(makeMedia({ id: 'm1' }))).toBe(true);
    expect(matches(makeMedia({ id: 'm2' }))).toBe(false);
  });

  it('passes the entity clause while the linked-media set is loading', () => {
    // Unknown-means-pass: a live update must never evict a row the server
    // itself returned for the filtered query.
    const matches = buildMediaMatches({ ...base, entityId: 'e-1' });
    expect(matches(makeMedia({ id: 'm2' }))).toBe(true);
  });
});

describe('MEDIA_SORT_OPTIONS', () => {
  const byValue = (value: string) => getMediaSortOption(value);

  it('falls back to the default sort for unknown values', () => {
    expect(getMediaSortOption('bogus').value).toBe(DEFAULT_MEDIA_SORT);
    expect(getMediaSortOption(null).value).toBe(DEFAULT_MEDIA_SORT);
  });

  it('never compares distinct records equal (total tiebreak)', () => {
    // Identical on every sort key except id.
    const a = makeMedia({ id: 'aaa' });
    const b = makeMedia({ id: 'bbb' });
    for (const option of MEDIA_SORT_OPTIONS) {
      expect(option.compare(a, b)).not.toBe(0);
      expect(Math.sign(option.compare(a, b))).toBe(
        -Math.sign(option.compare(b, a))
      );
    }
  });

  it('recent sorts newest first', () => {
    const newer = makeMedia({ id: 'n', created: T1 });
    const older = makeMedia({ id: 'o', created: T0 });
    expect(byValue('recent').compare(newer, older)).toBeLessThan(0);
    expect(byValue('recent').pbSort).toBe('-created');
  });

  it('duration sorts longest first, falling back to recency', () => {
    const long = makeMedia({ id: 'l', duration: 100 });
    const short = makeMedia({ id: 's', duration: 5 });
    expect(byValue('duration').compare(long, short)).toBeLessThan(0);

    const newer = makeMedia({ id: 'n', duration: 5, created: T1 });
    expect(byValue('duration').compare(newer, short)).toBeLessThan(0);
  });

  it('name sorts by upload name and cannot compare without the expand', () => {
    const option = byValue('name');
    const alpha = makeMedia({
      id: 'a',
      expand: { UploadRef: { id: 'u1', name: 'alpha.mp4' } },
    } as never);
    const zeta = makeMedia({
      id: 'z',
      expand: { UploadRef: { id: 'u2', name: 'zeta.mp4' } },
    } as never);
    expect(option.compare(alpha, zeta)).toBeLessThan(0);

    const bare = makeMedia({ id: 'b', expand: undefined } as never);
    expect(option.canCompare?.(bare)).toBe(false);
    expect(option.canCompare?.(alpha)).toBe(true);
  });

  it('media_time sorts newest date first with missing dates last', () => {
    const option = byValue('media_time');
    const dated = makeMedia({ id: 'd', mediaDate: T1 } as never);
    const undated = makeMedia({ id: 'u', mediaDate: '' } as never);
    expect(option.compare(dated, undated)).toBeLessThan(0);
    expect(option.compare(undated, dated)).toBeGreaterThan(0);
  });
});
