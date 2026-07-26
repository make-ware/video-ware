/**
 * Pure-function coverage for the clip live list: the client-side filter
 * mirror (buildClipMatches) and the sort descriptors whose comparators must
 * mirror their PocketBase sort strings with a total tiebreak.
 */
import { describe, it, expect } from 'vitest';
import type { ClipListItem } from '@/services/media-clip';
import { buildClipMatches } from '../use-clip-list';
import {
  CLIP_SORT_OPTIONS,
  MEDIA_SCOPED_CLIP_SORT_OPTIONS,
  getClipSortOption,
  DEFAULT_CLIP_SORT,
  DEFAULT_MEDIA_CLIP_SORT,
} from '@/components/clip/clip-sort';

const T0 = '2026-07-18 10:00:00.000Z';
const T1 = '2026-07-18 10:00:01.000Z';

interface MediaOverrides {
  DirectoryRef?: string;
  mediaType?: string;
  label?: string;
  description?: string;
  mediaDate?: string;
  uploadName?: string | null;
}

/** The MediaRef expand as the list fetch and the subscription deliver it. */
function makeMediaExpand(overrides: MediaOverrides = {}) {
  const { uploadName = 'clip.mp4', ...media } = overrides;
  return {
    id: 'md1',
    WorkspaceRef: 'ws-1',
    DirectoryRef: '',
    mediaType: 'video',
    label: '',
    description: '',
    mediaDate: '',
    ...media,
    expand:
      uploadName === null ? {} : { UploadRef: { id: 'u1', name: uploadName } },
  };
}

function makeClip(
  overrides: Partial<ClipListItem> = {},
  media: MediaOverrides | null = {}
): ClipListItem {
  return {
    id: 'c1',
    WorkspaceRef: 'ws-1',
    MediaRef: 'md1',
    type: 'user',
    label: '',
    description: '',
    start: 0,
    end: 10,
    duration: 10,
    created: T0,
    updated: T0,
    expand: media === null ? undefined : { MediaRef: makeMediaExpand(media) },
    ...overrides,
  } as unknown as ClipListItem;
}

describe('buildClipMatches', () => {
  const base = {
    workspaceId: 'ws-1',
    mediaId: null as string | null,
    directoryId: null as string | null,
    clipType: 'all',
    mediaType: 'all',
    search: '',
  };

  it('requires the workspace to match', () => {
    const matches = buildClipMatches(base);
    expect(matches(makeClip())).toBe(true);
    expect(matches(makeClip({ WorkspaceRef: 'ws-2' }))).toBe(false);
  });

  it('ignores directories when directoryId is null', () => {
    const matches = buildClipMatches(base);
    expect(matches(makeClip({}, { DirectoryRef: 'dir-1' }))).toBe(true);
  });

  it("matches the workspace root with directoryId ''", () => {
    const matches = buildClipMatches({ ...base, directoryId: '' });
    expect(matches(makeClip({}, { DirectoryRef: '' }))).toBe(true);
    expect(matches(makeClip({}, { DirectoryRef: 'dir-1' }))).toBe(false);
  });

  it('matches a specific directory through the MediaRef expand', () => {
    const matches = buildClipMatches({ ...base, directoryId: 'dir-1' });
    expect(matches(makeClip({}, { DirectoryRef: 'dir-1' }))).toBe(true);
    expect(matches(makeClip({}, { DirectoryRef: '' }))).toBe(false);
    // No expand (e.g. a bare delete event) reads as non-matching; the total
    // is trued up by the next refetch rather than mis-decremented here.
    expect(matches(makeClip({}, null))).toBe(false);
  });

  it('filters by clip type', () => {
    const matches = buildClipMatches({ ...base, clipType: 'shot' });
    expect(matches(makeClip({ type: 'shot' }))).toBe(true);
    expect(matches(makeClip({ type: 'user' }))).toBe(false);
  });

  it('filters by the source media type', () => {
    const matches = buildClipMatches({ ...base, mediaType: 'audio' });
    expect(matches(makeClip({}, { mediaType: 'audio' }))).toBe(true);
    expect(matches(makeClip({}, { mediaType: 'video' }))).toBe(false);
  });

  it('searches clip and media text case-insensitively', () => {
    const matches = buildClipMatches({ ...base, search: 'SUNSET' });
    expect(matches(makeClip({ label: 'Beach sunset take 2' }))).toBe(true);
    expect(matches(makeClip({ description: 'the sunset shot' }))).toBe(true);
    expect(matches(makeClip({}, { label: 'Sunset reel' }))).toBe(true);
    expect(matches(makeClip({}, { description: 'a sunset' }))).toBe(true);
    expect(matches(makeClip({}, { uploadName: 'Sunset.mp4' }))).toBe(true);
    expect(matches(makeClip())).toBe(false);
  });

  it('searches the clip type, mirroring the server filter', () => {
    const matches = buildClipMatches({ ...base, search: 'spe' });
    expect(matches(makeClip({ type: 'speech' }))).toBe(true);
  });

  it('treats whitespace-only search as no search', () => {
    const matches = buildClipMatches({ ...base, search: '   ' });
    expect(matches(makeClip())).toBe(true);
  });

  it('ignores the media scope when mediaId is null', () => {
    const matches = buildClipMatches(base);
    expect(matches(makeClip({ MediaRef: 'md-other' }))).toBe(true);
  });

  it('restricts to one media when mediaId is set', () => {
    const matches = buildClipMatches({ ...base, mediaId: 'md1' });
    expect(matches(makeClip({ MediaRef: 'md1' }))).toBe(true);
    expect(matches(makeClip({ MediaRef: 'md2' }))).toBe(false);
  });

  it('tests the media scope without needing the MediaRef expand', () => {
    // MediaRef is an own field, so an expand-less delete event still reads as
    // matching — which is what lets live-list decrement totalItems correctly.
    // Contrast the directory case above, where a bare delete cannot match.
    const matches = buildClipMatches({ ...base, mediaId: 'md1' });
    expect(matches(makeClip({ MediaRef: 'md1' }, null))).toBe(true);
  });

  it('combines the media scope with the clip-type filter', () => {
    const matches = buildClipMatches({
      ...base,
      mediaId: 'md1',
      clipType: 'shot',
    });
    expect(matches(makeClip({ MediaRef: 'md1', type: 'shot' }))).toBe(true);
    expect(matches(makeClip({ MediaRef: 'md1', type: 'user' }))).toBe(false);
    expect(matches(makeClip({ MediaRef: 'md2', type: 'shot' }))).toBe(false);
  });

  it('drops the media text fields from a media-scoped search', () => {
    // Mirrors searchExpr() in services/media-clip.ts: inside one media the
    // media's own text is constant, so matching it would return every clip.
    const scoped = buildClipMatches({
      ...base,
      mediaId: 'md1',
      search: 'SUNSET',
    });
    expect(scoped(makeClip({ label: 'Beach sunset' }))).toBe(true);
    expect(scoped(makeClip({}, { label: 'Sunset reel' }))).toBe(false);
    expect(scoped(makeClip({}, { uploadName: 'Sunset.mp4' }))).toBe(false);

    // Unscoped, those same records do match — the two mirrors differ on purpose.
    const unscoped = buildClipMatches({ ...base, search: 'SUNSET' });
    expect(unscoped(makeClip({}, { label: 'Sunset reel' }))).toBe(true);
    expect(unscoped(makeClip({}, { uploadName: 'Sunset.mp4' }))).toBe(true);
  });
});

describe('CLIP_SORT_OPTIONS', () => {
  const byValue = (value: string) => getClipSortOption(value);

  it('falls back to the default sort for unknown values', () => {
    expect(getClipSortOption('bogus').value).toBe(DEFAULT_CLIP_SORT);
    expect(getClipSortOption(null).value).toBe(DEFAULT_CLIP_SORT);
  });

  it('never compares distinct records equal (total tiebreak)', () => {
    // Identical on every sort key except id.
    const a = makeClip({ id: 'aaa' });
    const b = makeClip({ id: 'bbb' });
    for (const option of CLIP_SORT_OPTIONS) {
      expect(option.compare(a, b)).not.toBe(0);
      expect(Math.sign(option.compare(a, b))).toBe(
        -Math.sign(option.compare(b, a))
      );
    }
  });

  it('recent sorts newest first', () => {
    const newer = makeClip({ id: 'n', created: T1 });
    const older = makeClip({ id: 'o', created: T0 });
    expect(byValue('recent').compare(newer, older)).toBeLessThan(0);
    expect(byValue('recent').pbSort).toBe('-created');
  });

  it('duration sorts longest first, falling back to recency', () => {
    const long = makeClip({ id: 'l', duration: 100 });
    const short = makeClip({ id: 's', duration: 5 });
    expect(byValue('duration').compare(long, short)).toBeLessThan(0);

    const newer = makeClip({ id: 'n', duration: 5, created: T1 });
    expect(byValue('duration').compare(newer, short)).toBeLessThan(0);
  });

  it('name sorts by upload name and cannot compare without the expand', () => {
    const option = byValue('name');
    const alpha = makeClip({ id: 'a' }, { uploadName: 'alpha.mp4' });
    const zeta = makeClip({ id: 'z' }, { uploadName: 'zeta.mp4' });
    expect(option.compare(alpha, zeta)).toBeLessThan(0);

    expect(option.canCompare?.(alpha)).toBe(true);
    expect(option.canCompare?.(makeClip({ id: 'b' }, null))).toBe(false);
    // MediaRef present but its UploadRef missing is equally uncomparable.
    expect(
      option.canCompare?.(makeClip({ id: 'c' }, { uploadName: null }))
    ).toBe(false);
  });

  it('media_time sorts newest media first, then by clip start', () => {
    const option = byValue('media_time');
    const dated = makeClip({ id: 'd' }, { mediaDate: T1 });
    const undated = makeClip({ id: 'u' }, { mediaDate: '' });
    expect(option.compare(dated, undated)).toBeLessThan(0);
    expect(option.compare(undated, dated)).toBeGreaterThan(0);

    const early = makeClip({ id: 'e', start: 1 }, { mediaDate: T1 });
    const late = makeClip({ id: 'l', start: 9 }, { mediaDate: T1 });
    expect(option.compare(early, late)).toBeLessThan(0);

    expect(option.canCompare?.(dated)).toBe(true);
    expect(option.canCompare?.(makeClip({ id: 'b' }, null))).toBe(false);
  });

  it('timeline sorts by start ascending, then recency', () => {
    const option = byValue('timeline');
    const early = makeClip({ id: 'e', start: 1 });
    const late = makeClip({ id: 'l', start: 9 });
    expect(option.compare(early, late)).toBeLessThan(0);
    expect(option.pbSort).toBe('start,-created');

    // Equal starts are common (0, or two labels on the same frame).
    const newer = makeClip({ id: 'n', start: 1, created: T1 });
    expect(option.compare(newer, early)).toBeLessThan(0);
  });

  it('timeline needs no expand to compare', () => {
    // `start` is an own field, so unlike name/media_time a media-scoped list
    // can position live-inserted records exactly instead of bumping the total.
    const option = byValue('timeline');
    expect(option.canCompare).toBeUndefined();
    expect(
      option.compare(
        makeClip({ id: 'a', start: 1 }, null),
        makeClip({ id: 'b', start: 9 }, null)
      )
    ).toBeLessThan(0);
  });

  it('offers timeline first for media-scoped lists', () => {
    expect(MEDIA_SCOPED_CLIP_SORT_OPTIONS.map((o) => o.value)).toEqual([
      'timeline',
      'recent',
      'duration',
    ]);
    expect(DEFAULT_MEDIA_CLIP_SORT).toBe('timeline');
  });

  it('resolves every offered sort value', () => {
    // Guards the silent-fallback footgun: a subset built from a value missing
    // from the registry would resolve to `recent` instead of erroring.
    for (const option of [
      ...CLIP_SORT_OPTIONS,
      ...MEDIA_SCOPED_CLIP_SORT_OPTIONS,
    ]) {
      expect(getClipSortOption(option.value).value).toBe(option.value);
    }
  });
});
