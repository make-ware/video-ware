'use client';

/**
 * The label application of the generic infinite list (see use-infinite-list.ts):
 * ONE paged, server-filtered read behind all eight label surfaces, driven by a
 * declarative per-type `LabelListSource`.
 *
 * The source is the boilerplate-killer. Structural facts (collection,
 * confidence field) come from the shared LABEL_TYPE_META rather than being
 * restated per page, so a page contributes only what is genuinely its own:
 * which fields the text query matches, the sort, the expands it renders. Every
 * label page then reads the same result shape (items / totalItems / loadMore),
 * which is what makes the Load More footer identical across all of them.
 *
 * Deliberately not live (plain `useInfiniteList`, not `useLiveInfiniteList`):
 * labels are written in bulk by the worker's label jobs — thousands of rows per
 * ingest — so a per-row SSE stream would be a flood for no benefit, and the
 * writes a user actually makes here (entity links) invalidate the `['labels']`
 * prefix directly.
 *
 * Filtering is entirely server-side: every clause is bound through `pb.filter`,
 * one clause at a time so distinct clauses can each use `{:v}`. Field names come
 * from the source descriptor (code), only values are ever bound.
 */
import type { RecordListOptions } from 'pocketbase';
import { LabelType } from '@project/shared';
import type { Entity, LabelEntity, LabelTrack, Media } from '@project/shared';
import {
  LABEL_TYPE_META,
  SPEAKER_PANEL_FIELDS,
  type ActualizableLabel,
} from '@project/shared/mutator';
import pb from '@/lib/pocketbase-client';
import { qk } from '@/lib/query-keys';
import { useAuth } from '@/hooks/use-auth';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import {
  useInfiniteList,
  type UseInfiniteListResult,
} from '@/hooks/use-infinite-list';
import type { ExpandedMedia } from '@/types/expanded-types';

export const LABELS_PAGE_SIZE = 100;

/**
 * A label row with the expands the label surfaces render.
 *
 * LabelTrackRef supplies the track payload (preview animation, crop thumbnail,
 * stat tiles); LabelEntityRef carries the entity link the detail panel and the
 * speaker chips read and write; MediaRef backs the filmstrip preview.
 */
export type LabelRecord = ActualizableLabel & {
  expand?: {
    LabelTrackRef?: LabelTrack;
    LabelEntityRef?: LabelEntity & { expand?: { EntityRef?: Entity } };
    MediaRef?: Media | ExpandedMedia;
  };
};

/**
 * Entity attributed to a label row, mirroring entityAttributionFilter: one
 * hop through the row's LabelEntity. '' when unattributed.
 *
 * There is no fallback chain any more — LabelEntity is per-media and
 * per-instance, so it is the only link point and nothing overrides it.
 */
export function effectiveEntityId(record: LabelRecord): string {
  return record.expand?.LabelEntityRef?.EntityRef || '';
}

/** What to page, in what order, matched on what. One per label type. */
export interface LabelListSource {
  labelType: LabelType;
  /** PB collection backing the type (from LABEL_TYPE_META). */
  collection: string;
  /** Confidence column — LabelFaces uses avgConfidence (from LABEL_TYPE_META). */
  confidenceField: 'confidence' | 'avgConfidence';
  /** Fields matched with `~` by the text query; empty = search unsupported. */
  queryFields: readonly string[];
  /** Server sort. Must be total-ordered enough to page stably. */
  sort: string;
  /** Comma-separated expand paths, or '' for none. */
  expand: string;
  /** PocketBase `fields` projection, or [] for whole records. */
  fields: readonly string[];
  perPage: number;
}

/** Expands the list rows and detail panel render for tracked types. */
const TRACK_EXPAND =
  'LabelTrackRef,LabelEntityRef,MediaRef,MediaRef.filmstripFileRefs';
/** Same minus LabelTrackRef — shots and segments have no track relation. */
const TRACKLESS_EXPAND = 'LabelEntityRef,MediaRef,MediaRef.filmstripFileRefs';

function source(
  labelType: LabelType,
  overrides: Partial<Omit<LabelListSource, 'labelType'>> = {}
): LabelListSource {
  const meta = LABEL_TYPE_META[labelType];
  return {
    labelType,
    collection: meta.collection,
    confidenceField: meta.confidenceField,
    queryFields: [],
    sort: 'start',
    expand: meta.hasTrack ? TRACK_EXPAND : TRACKLESS_EXPAND,
    fields: [],
    perPage: LABELS_PAGE_SIZE,
    ...overrides,
  };
}

/**
 * Every label type's read shape. Exhaustive by construction — a new LabelType
 * fails to compile until it is listed here, the same checklist discipline the
 * CLI's LABEL_TYPE_CONFIG follows.
 */
export const LABEL_LIST_SOURCES: Record<LabelType, LabelListSource> = {
  [LabelType.OBJECT]: source(LabelType.OBJECT, { queryFields: ['entity'] }),
  [LabelType.FACE]: source(LabelType.FACE, { queryFields: ['faceId'] }),
  [LabelType.PERSON]: source(LabelType.PERSON, {
    queryFields: ['personId', 'upperBodyColor', 'lowerBodyColor'],
  }),
  [LabelType.SHOT]: source(LabelType.SHOT, { queryFields: ['entity'] }),
  [LabelType.SEGMENT]: source(LabelType.SEGMENT, { queryFields: ['entity'] }),
  [LabelType.TEXT]: source(LabelType.TEXT, { queryFields: ['text'] }),
  // The speaker chips and the transcript label both resolve through the
  // LabelEntity, and the projection drops the per-word timings no speaker
  // surface reads (naming any field would strip the expands, hence the
  // expand.* paths inside SPEAKER_PANEL_FIELDS).
  [LabelType.SPEAKER]: source(LabelType.SPEAKER, {
    queryFields: ['transcript'],
    expand: 'LabelEntityRef.EntityRef',
    fields: SPEAKER_PANEL_FIELDS,
  }),
  [LabelType.SPEECH]: source(LabelType.SPEECH, {
    queryFields: ['transcript'],
    expand: '',
  }),
};

export function labelSource(labelType: LabelType): LabelListSource {
  return LABEL_LIST_SOURCES[labelType];
}

export interface LabelListFilters {
  /** 0 disables the clause. */
  minConfidence: number;
  /** Seconds; 0 disables the clause. */
  minDuration: number;
  /** Raw text input — debounced inside the hook before it reaches the key. */
  query: string;
  /**
   * Extra `field = value` clauses, e.g. `{ speakerId }`. Empty/undefined
   * values drop their clause, so "all speakers" is just `{ speakerId: null }`.
   */
  equals?: Record<string, string | null | undefined>;
}

/** Filters with nothing selected — the "show everything" baseline. */
export const NO_LABEL_FILTERS: LabelListFilters = {
  minConfidence: 0,
  minDuration: 0,
  query: '',
};

/** True when any clause is narrowing the list (drives the "clear" affordance). */
export function hasActiveLabelFilters(filters: LabelListFilters): boolean {
  return (
    filters.minConfidence > 0 ||
    filters.minDuration > 0 ||
    filters.query.trim() !== '' ||
    Object.values(filters.equals ?? {}).some(Boolean)
  );
}

/** `equals` with the empty entries dropped — the query-key-stable form. */
export function activeEquals(
  filters: LabelListFilters
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [field, value] of Object.entries(filters.equals ?? {})) {
    if (value) out[field] = value;
  }
  return out;
}

/**
 * The PocketBase filter for one media's labels of one type. Pure, so the
 * clause set is unit-testable without a client.
 */
export function buildLabelFilter(
  sourceSpec: LabelListSource,
  mediaId: string,
  filters: LabelListFilters
): string {
  const clauses = [pb.filter('MediaRef = {:v}', { v: mediaId })];

  if (filters.minConfidence > 0) {
    clauses.push(
      pb.filter(`${sourceSpec.confidenceField} >= {:v}`, {
        v: filters.minConfidence,
      })
    );
  }
  if (filters.minDuration > 0) {
    clauses.push(pb.filter('duration >= {:v}', { v: filters.minDuration }));
  }
  for (const [field, value] of Object.entries(activeEquals(filters))) {
    clauses.push(pb.filter(`${field} = {:v}`, { v: value }));
  }

  const query = filters.query.trim();
  if (query && sourceSpec.queryFields.length > 0) {
    const matches = sourceSpec.queryFields.map((field) =>
      pb.filter(`${field} ~ {:v}`, { v: query })
    );
    clauses.push(`(${matches.join(' || ')})`);
  }

  return clauses.join(' && ');
}

export interface UseLabelListArgs {
  mediaId: string;
  source: LabelListSource;
  filters: LabelListFilters;
  /** Hold the fetch (e.g. this media type has no labels of this kind). */
  enabled?: boolean;
}

export function useLabelList<T extends LabelRecord = LabelRecord>(
  args: UseLabelListArgs
): UseInfiniteListResult<T> {
  const { mediaId, source: sourceSpec, filters, enabled = true } = args;
  const { isAuthenticated } = useAuth();

  // The debounced query is what the request and the key must agree on — the
  // raw input is only ever a keystroke ahead of it. Nothing here needs
  // memoizing: query keys are compared structurally, and `fetchPage` is read
  // fresh on every fetch.
  const search = useDebouncedValue(filters.query).trim();
  const equals = activeEquals(filters);
  const resolved: LabelListFilters = { ...filters, query: search };

  return useInfiniteList<T>({
    queryKey: qk.labels.list({
      mediaId,
      labelType: sourceSpec.labelType,
      minConfidence: resolved.minConfidence,
      minDuration: resolved.minDuration,
      search,
      equals,
    }),
    enabled: enabled && !!mediaId && isAuthenticated,
    fetchPage: (page) => {
      const options: RecordListOptions = {
        filter: buildLabelFilter(sourceSpec, mediaId, resolved),
        sort: sourceSpec.sort,
      };
      if (sourceSpec.expand) options.expand = sourceSpec.expand;
      if (sourceSpec.fields.length > 0) {
        options.fields = sourceSpec.fields.join(',');
      }
      // TypedPocketBase's collection() overloads reject a union of names; the
      // explicit getList generic restores the record type.
      return pb
        .collection(sourceSpec.collection as 'LabelObjects')
        .getList<T>(page, sourceSpec.perPage, options);
    },
  });
}
