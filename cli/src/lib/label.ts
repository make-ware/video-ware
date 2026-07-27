import type { ListResult } from 'pocketbase';
import {
  LABEL_TYPE_META,
  LabelType,
  LabelFaceMutator,
  LabelObjectMutator,
  LabelPersonMutator,
  LabelSegmentMutator,
  LabelShotMutator,
  LabelSpeakerMutator,
  LabelSpeechMutator,
  LabelTextMutator,
  MediaClipMutator,
  TimelineClipMutator,
  getCompositeSegments,
  speakerTranscriptLabel,
  windowCompositeSegments,
  type ActualizableLabel,
  type CompositeSegment,
  type Entity,
  type MediaClip,
  type TypedPocketBase,
} from '@project/shared';

// Attribution helpers now live in shared (webapp uses them too); re-exported
// so CLI callers keep importing them from this module.
import { attributionExpands, labelAttributionFilter } from '@project/shared';
export { attributionExpands, labelAttributionFilter };
import { mediaLabel, pickMedia, type MediaWithUpload } from './select.js';
import { resolveTimelineEditList } from './timeline-clip.js';
import type { EditListSource } from './clip-times.js';
import { parseSeconds, type OptionGroupOf } from './options.js';
import { truncate, type Column } from './output.js';
import {
  listFilter,
  type ListSpec,
  type MergeSource,
  type SortRegistry,
} from './list/index.js';

/**
 * A label row, possibly expanded with its media (and that media's upload)
 * and the LabelEntity its attribution resolves through.
 */
export type LabelRecord = ActualizableLabel & {
  expand?: {
    MediaRef?: MediaWithUpload;
    LabelEntityRef?: { expand?: { EntityRef?: Entity } };
  };
};

/**
 * Compact identity context for a label row's attributed Entity, safe to
 * attach to any JSON output (labels' own fields never collide with the
 * `attributedEntity` key — object/shot/segment rows already use `entity`
 * for the provider's term).
 */
export interface AttributedEntity {
  id: string;
  name: string;
  kind: Entity['kind'];
}

/** One search/list result: a label row tagged with its label type. */
export interface LabelHit {
  type: LabelType;
  record: LabelRecord;
  /** Identity context; present only when the label resolves to an Entity. */
  attributedEntity?: AttributedEntity;
}

/** Validate a label type string against the LabelType enum. */
export function parseLabelType(value: string): LabelType {
  const types = Object.values(LabelType) as string[];
  if (!types.includes(value)) {
    throw new Error(
      `Invalid label type "${value}". Valid types: ${types.join(', ')}`
    );
  }
  return value as LabelType;
}

/** Parse a comma-separated list of label types. */
export function parseLabelTypes(value: string): LabelType[] {
  return value.split(',').map((t) => parseLabelType(t.trim()));
}

/** Read a field off a label record as display text. */
function textField(record: LabelRecord, key: string): string {
  const value = (record as Record<string, unknown>)[key];
  if (typeof value === 'string') return value;
  return value == null ? '' : String(value);
}

/**
 * The Entity a label row is attributed to, read off its expanded
 * LabelEntity — one hop, the model's only link point. Null when unattributed
 * (or when the query didn't request the attribution expands).
 */
export function attributedEntityOf(record: LabelRecord): Entity | null {
  return record.expand?.LabelEntityRef?.expand?.EntityRef ?? null;
}

/**
 * The attributed Entity as the compact summary label outputs embed. Same
 * resolution (and same null cases) as attributedEntityOf.
 */
export function attributedEntitySummaryOf(
  record: LabelRecord
): AttributedEntity | null {
  const entity = attributedEntityOf(record);
  if (!entity) return null;
  return { id: entity.id, name: entity.name, kind: entity.kind };
}

/** Build a LabelHit, attaching the attributed-entity context when present. */
export function toLabelHit(type: LabelType, record: LabelRecord): LabelHit {
  const attributedEntity = attributedEntitySummaryOf(record);
  return attributedEntity
    ? { type, record, attributedEntity }
    : { type, record };
}

export interface LabelTypeConfig {
  /** Fields matched (`~`) by the free-text search query. */
  queryFields: string[];
  /** Short text for the MATCH/TEXT column. */
  snippet: (record: LabelRecord) => string;
}

/**
 * Per-type search contract: which fields a query matches, per collection.
 * Structural facts (collection, hasTrack, confidenceField) live in the
 * shared LABEL_TYPE_META; this holds only the CLI's display concerns.
 */
export const LABEL_TYPE_CONFIG: Record<LabelType, LabelTypeConfig> = {
  [LabelType.OBJECT]: {
    queryFields: ['entity'],
    snippet: (r) => textField(r, 'entity'),
  },
  [LabelType.SHOT]: {
    queryFields: ['entity'],
    snippet: (r) => textField(r, 'entity'),
  },
  [LabelType.PERSON]: {
    queryFields: ['upperBodyColor', 'lowerBodyColor'],
    snippet: (r) =>
      [
        textField(r, 'personId'),
        textField(r, 'upperBodyColor'),
        textField(r, 'lowerBodyColor'),
      ]
        .filter(Boolean)
        .join(' '),
  },
  [LabelType.SPEECH]: {
    queryFields: ['transcript'],
    snippet: (r) => textField(r, 'transcript'),
  },
  [LabelType.SPEAKER]: {
    queryFields: ['transcript', 'speakerId'],
    snippet: (r) =>
      [
        speakerTranscriptLabel(
          textField(r, 'speakerId'),
          attributedEntityOf(r)?.name
        ),
        textField(r, 'transcript'),
      ]
        .filter(Boolean)
        .join(': '),
  },
  [LabelType.FACE]: {
    queryFields: ['faceId'],
    snippet: (r) => textField(r, 'faceId') || textField(r, 'faceHash'),
  },
  [LabelType.SEGMENT]: {
    queryFields: ['entity'],
    snippet: (r) => textField(r, 'entity'),
  },
  [LabelType.TEXT]: {
    queryFields: ['text'],
    snippet: (r) => textField(r, 'text'),
  },
};

/** Exact-id flags: each implies a label type and matches one field exactly. */
const ID_FLAGS = {
  faceId: { type: LabelType.FACE, field: 'faceId', flag: '--face-id' },
  personId: { type: LabelType.PERSON, field: 'personId', flag: '--person-id' },
  trackId: {
    type: LabelType.OBJECT,
    field: 'originalTrackId',
    flag: '--track-id',
  },
} as const;

type IdFlagKey = keyof typeof ID_FLAGS;

/** Minimal read surface common to all per-type label mutators. */
interface LabelCollectionMutator {
  getById(id: string, expand?: string[]): Promise<LabelRecord | null>;
  getList(
    page?: number,
    perPage?: number,
    filter?: string | string[],
    sort?: string,
    expand?: string[]
  ): Promise<ListResult<LabelRecord>>;
  /**
   * Narrowed to the one field the CLI writes on a label row: the link to its
   * LabelEntity, repaired when a partial label run left it blank (see
   * `labelEntityForRow`). Everything else about a label row is the provider's
   * to write.
   */
  update(
    id: string,
    input: { LabelEntityRef: string }
  ): Promise<LabelRecord | unknown>;
}

/** The per-type mutator backing a label type's collection. */
export function labelMutator(
  pb: TypedPocketBase,
  type: LabelType
): LabelCollectionMutator {
  switch (type) {
    case LabelType.OBJECT:
      return new LabelObjectMutator(pb);
    case LabelType.SHOT:
      return new LabelShotMutator(pb);
    case LabelType.PERSON:
      return new LabelPersonMutator(pb);
    case LabelType.SPEECH:
      return new LabelSpeechMutator(pb);
    case LabelType.SPEAKER:
      return new LabelSpeakerMutator(pb);
    case LabelType.FACE:
      return new LabelFaceMutator(pb);
    case LabelType.SEGMENT:
      return new LabelSegmentMutator(pb);
    case LabelType.TEXT:
      return new LabelTextMutator(pb);
  }
}

/** A hit's confidence, normalized across the per-type field names. */
export function confidenceOf(hit: LabelHit): number {
  const field = LABEL_TYPE_META[hit.type].confidenceField;
  const value = (hit.record as Record<string, unknown>)[field];
  return typeof value === 'number' ? value : 0;
}

/** Human-readable name for a hit's source media. */
export function labelMediaName(hit: LabelHit): string {
  const media = hit.record.expand?.MediaRef;
  return media ? mediaLabel(media) : hit.record.MediaRef;
}

/**
 * Shared column layout for label hits (`label search`/`list`, `entity
 * labels`). ENTITY is the attributed real-world Entity, resolved live from
 * the expands attributionExpands requests — blank when unattributed.
 */
export const hitColumns = (withMedia: boolean): Column<LabelHit>[] => [
  { header: 'TYPE', value: (h) => h.type },
  { header: 'ID', value: (h) => h.record.id },
  ...(withMedia
    ? [{ header: 'MEDIA', value: (h: LabelHit) => labelMediaName(h) }]
    : []),
  { header: 'START', value: (h) => `${h.record.start.toFixed(2)}s` },
  { header: 'END', value: (h) => `${h.record.end.toFixed(2)}s` },
  { header: 'CONF', value: (h) => confidenceOf(h).toFixed(2) },
  {
    header: 'ENTITY',
    value: (h) => attributedEntityOf(h.record)?.name ?? '',
  },
  {
    header: withMedia ? 'MATCH' : 'TEXT',
    value: (h) => truncate(LABEL_TYPE_CONFIG[h.type].snippet(h.record)),
  },
];

/**
 * Sorting a label fan-out is not one PocketBase sort string: confidence lives
 * under a different field name in every label collection
 * (`LABEL_TYPE_META[type].confidenceField`). So the label specs' `pbSort`
 * carries a *logical* key, which `labelPbSort` turns into a per-collection
 * sort and `labelHitCompare` turns into the matching merge comparator. The two
 * must always agree — a source sorted differently from the merge would make
 * its "top K" not the top K, and the merge-slice would silently lose rows.
 */
export const LABEL_SORT_CONFIDENCE = 'confidence';
export const LABEL_SORT_START = 'start';
export const LABEL_SORT_MEDIA = 'media';

/** `label search` — best matches first. */
export const LABEL_SEARCH_SORTS: SortRegistry = [
  {
    value: 'confidence',
    description: 'most confident first',
    pbSort: LABEL_SORT_CONFIDENCE,
  },
  { value: 'start', description: 'chronological', pbSort: LABEL_SORT_START },
  {
    value: 'media',
    description: 'grouped by media, then chronological',
    pbSort: LABEL_SORT_MEDIA,
  },
];

/** `label list` / `entity labels` — chronological reading order first. */
export const LABEL_LIST_SORTS: SortRegistry = [
  { value: 'start', description: 'chronological', pbSort: LABEL_SORT_START },
  {
    value: 'media',
    description: 'grouped by media, then chronological',
    pbSort: LABEL_SORT_MEDIA,
  },
  {
    value: 'confidence',
    description: 'most confident first',
    pbSort: LABEL_SORT_CONFIDENCE,
  },
];

/**
 * One collection's sort string for a logical label sort key.
 *
 * Each string ends in `id`, mirroring `labelHitCompare`'s id tiebreak: the
 * per-source query must itself be a total order, because `fetchMergedPage`
 * re-reads each source's top K on every page request — two rows tied on the
 * primary keys could otherwise swap sides of that cutoff between requests,
 * duplicating or dropping a row before the client-side comparator ever runs.
 */
export function labelPbSort(type: LabelType, logical: string): string {
  switch (logical) {
    case LABEL_SORT_CONFIDENCE:
      return `-${LABEL_TYPE_META[type].confidenceField},id`;
    case LABEL_SORT_MEDIA:
      return 'MediaRef,start,id';
    default:
      return 'start,MediaRef,id';
  }
}

/**
 * The merge comparator matching `labelPbSort`. Every ordering ends in an id
 * tiebreak so distinct rows never compare equal: without a total order a
 * merged page boundary is ambiguous and a row can land on two pages or none.
 */
export function labelHitCompare(
  logical: string
): (a: LabelHit, b: LabelHit) => number {
  const byId = (a: LabelHit, b: LabelHit) =>
    a.record.id < b.record.id ? -1 : a.record.id > b.record.id ? 1 : 0;
  const byMedia = (a: LabelHit, b: LabelHit) =>
    a.record.MediaRef.localeCompare(b.record.MediaRef);
  const byStart = (a: LabelHit, b: LabelHit) => a.record.start - b.record.start;

  switch (logical) {
    case LABEL_SORT_CONFIDENCE:
      return (a, b) => confidenceOf(b) - confidenceOf(a) || byId(a, b);
    case LABEL_SORT_MEDIA:
      return (a, b) => byMedia(a, b) || byStart(a, b) || byId(a, b);
    default:
      return (a, b) => byStart(a, b) || byMedia(a, b) || byId(a, b);
  }
}

/** AND a set of clauses, parenthesising each when more than one applies. */
function andClauses(clauses: readonly string[]): string {
  const parts = clauses.filter((c) => c.length > 0);
  if (parts.length <= 1) return parts[0] ?? '';
  return parts.map((c) => `(${c})`).join(' && ');
}

export interface LabelSourceOptions {
  /** Collections to query — one merge source each. */
  types: readonly LabelType[];
  /** The type-agnostic, already-bound filter from the resolved query. */
  baseFilter: string;
  /** Logical sort key (the resolved query's `sort`). */
  sort: string;
  /**
   * Clauses that can only be written per collection: the free-text query
   * (each type searches different fields), entity attribution, exact-id
   * flags, and minimum confidence.
   */
  perType?: (type: LabelType) => string[];
  /** Expands to request in addition to each type's attribution expands. */
  expand?: readonly string[];
}

/**
 * One merge source per label type, each yielding `LabelHit`s already tagged
 * with their type and attributed entity. `runMergedList` reads the requested
 * depth from every source and slices the merge (see list/paginate.ts).
 */
export function labelMergeSources(
  pb: TypedPocketBase,
  opts: LabelSourceOptions
): MergeSource<LabelHit>[] {
  return opts.types.map((type) => ({
    key: type,
    fetchPage: async ({ page, perPage }) => {
      const result = await labelMutator(pb, type).getList(
        page,
        perPage,
        andClauses([opts.baseFilter, ...(opts.perType?.(type) ?? [])]),
        labelPbSort(type, opts.sort),
        [...(opts.expand ?? []), ...attributionExpands(type)]
      );
      return {
        ...result,
        items: result.items.map((record) => toLabelHit(type, record)),
      };
    },
  }));
}

/** The `--min-confidence` clause for one collection. */
export function minConfidenceClause(
  pb: TypedPocketBase,
  type: LabelType,
  min: number
): string {
  return pb.filter(`${LABEL_TYPE_META[type].confidenceField} >= {:min}`, {
    min,
  });
}

/** The free-text clause for one collection (its own searchable fields). */
export function queryFieldsClause(
  pb: TypedPocketBase,
  type: LabelType,
  query: string
): string {
  const fields = LABEL_TYPE_CONFIG[type].queryFields;
  return pb.filter(fields.map((f) => `${f} ~ {:q}`).join(' || '), { q: query });
}

/** The exact-id clause for one collection, when an id flag targets it. */
export function idFlagClauses(
  pb: TypedPocketBase,
  type: LabelType,
  opts: Record<string, unknown>
): string[] {
  return (Object.keys(ID_FLAGS) as IdFlagKey[])
    .filter((key) => opts[key] !== undefined && ID_FLAGS[key].type === type)
    .map((key) =>
      pb.filter(`${ID_FLAGS[key].field} = {:v}`, {
        v: String(opts[key]),
      })
    );
}

/**
 * Which collections a label query should span: an exact-id flag pins the type
 * it belongs to, otherwise `--types` (or every type). A `--types` that
 * disagrees with an id flag is a mistake worth reporting rather than silently
 * resolving one way.
 */
export function resolveLabelTypes(opts: {
  types?: readonly LabelType[];
  faceId?: unknown;
  personId?: unknown;
  trackId?: unknown;
}): LabelType[] {
  const idFlags = (Object.keys(ID_FLAGS) as IdFlagKey[]).filter(
    (key) => opts[key] !== undefined
  );
  const implied = [...new Set(idFlags.map((key) => ID_FLAGS[key].type))];

  if (opts.types && implied.length > 0) {
    const sameSet =
      opts.types.length === implied.length &&
      implied.every((t) => opts.types!.includes(t));
    if (!sameSet) {
      throw new Error(
        `--types ${opts.types.join(',')} conflicts with ${idFlags
          .map((key) => ID_FLAGS[key].flag)
          .join('/')} (implies --types ${implied.join(',')})`
      );
    }
  }
  if (implied.length > 0) return implied;
  return [...(opts.types ?? Object.values(LabelType))];
}

/**
 * The per-collection clauses for a label fan-out: everything whose field name
 * or shape varies by label type. The type-agnostic parts (workspace scope,
 * `MediaRef`) come from the spec's own filters instead.
 */
export function labelPerTypeClauses(
  pb: TypedPocketBase,
  opts: {
    /** Free-text query, matched against each type's own search fields. */
    search?: string;
    minConfidence?: number;
    /** Resolved Entity record id (already looked up from a name). */
    entityId?: string;
    faceId?: string;
    personId?: string;
    trackId?: string;
  }
): (type: LabelType) => string[] {
  return (type) => [
    ...(opts.search ? [queryFieldsClause(pb, type, opts.search)] : []),
    ...idFlagClauses(pb, type, opts as Record<string, unknown>),
    ...(opts.minConfidence !== undefined
      ? [minConfidenceClause(pb, type, opts.minConfidence)]
      : []),
    // A record id from resolveEntity, and the shared attribution filters are
    // string templates rather than bound params — safe to embed directly.
    ...(opts.entityId ? [labelAttributionFilter(type, opts.entityId)] : []),
  ];
}

/** The exact-id flags, shared by the label list specs. */
const labelIdFilters = {
  faceId: listFilter({
    flags: '--face-id <id>',
    description: 'exact faceId match (implies --types face)',
    clause: () => null,
  }),
  personId: listFilter({
    flags: '--person-id <id>',
    description: 'exact personId match (implies --types person)',
    clause: () => null,
  }),
  trackId: listFilter({
    flags: '--track-id <id>',
    description: 'exact object track id match (implies --types object)',
    clause: () => null,
  }),
};

/**
 * `label search` — across every label collection in the workspace.
 *
 * Most of these filters declare `clause: () => null`: their real clause can
 * only be written per collection (see `labelPerTypeClauses`), and `--types`
 * selects which collections to query at all rather than filtering rows. They
 * still belong in the spec, which owns flag registration, `--help`, the
 * requirement below, and the footer's "narrow instead" list.
 *
 * A bare `label search` would scan every label in the workspace, so it
 * requires something to search for.
 */
export const labelSearchSpec: ListSpec<LabelHit> = {
  command: 'label search',
  sorts: LABEL_SEARCH_SORTS,
  requireOneOf: ['search', 'entity', 'faceId', 'personId', 'trackId'],
  filters: {
    search: listFilter({
      flags: '--search <text>',
      description:
        "free-text match against each label type's searchable fields " +
        '(transcript, entity, text, …)',
      clause: () => null,
    }),
    types: listFilter({
      flags: '-t, --types <types>',
      description: `comma-separated label types (${Object.values(LabelType).join(', ')}; default: all)`,
      parse: parseLabelTypes,
      clause: () => null,
    }),
    media: listFilter({
      flags: '-m, --media <id>',
      description: 'restrict results to one media',
      clause: (id) => ({ expr: 'MediaRef = {:m}', params: { m: id } }),
    }),
    entity: listFilter({
      flags: '--entity <nameOrId>',
      description:
        'only labels attributed to this entity (tagged track or cluster)',
      clause: () => null,
    }),
    ...labelIdFilters,
    minConfidence: listFilter({
      flags: '--min-confidence <n>',
      description: 'minimum confidence (0..1)',
      parse: parseFloat,
      clause: () => null,
    }),
  },
  columns: hitColumns(true),
  hint: '`vw label show <type> <id>` shows one record, `vw label clip <type> <id>` creates a clip',
};

/**
 * `label list` — one media's labels. Requires `-m` rather than defaulting to a
 * workspace-wide scan; on a TTY it offers the media picker instead.
 *
 * `--clip`/`--timeline-clip` scope the list to what a clip actually plays.
 * Those two can't be expressed as a clause: the clip supplies the media, and
 * "overlaps a played segment" is a predicate over its whole edit list. The
 * command resolves the clip up front, feeds `media` and the outer span
 * (`--from`/`--to`) back through this spec, and hides the gap-only rows with a
 * `ListRefinement` — so the flags still live here, where `--help` and the
 * footer's "narrow instead" list can see them.
 */
export const labelListSpec: ListSpec<LabelHit> = {
  command: 'label list',
  workspaceScoped: false,
  sorts: LABEL_LIST_SORTS,
  required: ['media'],
  filters: {
    media: listFilter({
      flags: '-m, --media <id>',
      description: 'the media whose labels to list',
      clause: (id) => ({ expr: 'MediaRef = {:m}', params: { m: id } }),
      pick: async ({ pb, workspaceId }) =>
        (await pickMedia(pb, workspaceId!)).id,
    }),
    clip: listFilter({
      flags: '--clip <mediaClipId>',
      description:
        "filter to a MediaClip's played edit list (labels inside cut gaps hidden)",
      clause: () => null,
    }),
    timelineClip: listFilter({
      flags: '--timeline-clip <id>',
      description:
        "filter to a TimelineClip's played edit list (labels inside cut gaps hidden)",
      clause: () => null,
    }),
    from: listFilter({
      flags: '--from <seconds>',
      description: 'only labels overlapping at/after this source time',
      parse: parseSeconds,
      clause: (start) => ({
        expr: 'end > {:wStart}',
        params: { wStart: start },
      }),
    }),
    to: listFilter({
      flags: '--to <seconds>',
      description: 'only labels overlapping before this source time',
      parse: parseSeconds,
      clause: (end) => ({ expr: 'start < {:wEnd}', params: { wEnd: end } }),
    }),
    types: listFilter({
      flags: '-t, --types <types>',
      description: `comma-separated label types (${Object.values(LabelType).join(', ')}; default: all)`,
      parse: parseLabelTypes,
      clause: () => null,
    }),
    entity: listFilter({
      flags: '--entity <nameOrId>',
      description:
        'only labels attributed to this entity (tagged track or cluster)',
      clause: () => null,
    }),
    search: listFilter({
      flags: '--search <text>',
      description: "free-text match against each label type's fields",
      clause: () => null,
    }),
    minConfidence: listFilter({
      flags: '--min-confidence <n>',
      description: 'minimum confidence (0..1)',
      parse: parseFloat,
      clause: () => null,
    }),
  },
  columns: hitColumns(false),
  hint: '`vw label show <type> <id>` shows one record',
};

export interface SearchLabelsOptions {
  workspaceId: string;
  /** Free-text query matched against each type's search fields. */
  query?: string;
  /** Label types to search. Defaults to all types. */
  types?: LabelType[];
  /** Restrict results to one media. */
  media?: string;
  /** Only labels attributed to this Entity (resolved record id). */
  entityId?: string;
  /** Exact faceId match (implies types = [face]). */
  faceId?: string;
  /** Exact personId match (implies types = [person]). */
  personId?: string;
  /** Exact object track id match (implies types = [object]). */
  trackId?: string;
  /** Minimum confidence (0..1). */
  minConfidence?: number;
  /** Max results per label type. Defaults to 20. */
  limit?: number;
}

/** `label search` flags for the optional SearchLabelsOptions fields above. */
export const labelSearchOptions = {
  types: {
    flags: '-t, --types <types>',
    description: `comma-separated label types (${Object.values(LabelType).join(', ')}; default: all)`,
    parse: parseLabelTypes,
  },
  media: {
    flags: '-m, --media <id>',
    description: 'restrict results to one media',
  },
  faceId: {
    flags: '--face-id <id>',
    description: 'exact faceId match (implies --types face)',
  },
  personId: {
    flags: '--person-id <id>',
    description: 'exact personId match (implies --types person)',
  },
  trackId: {
    flags: '--track-id <id>',
    description: 'exact object track id match (implies --types object)',
  },
  minConfidence: {
    flags: '--min-confidence <n>',
    description: 'minimum confidence (0..1)',
    parse: parseFloat,
  },
  limit: {
    flags: '-n, --limit <count>',
    description: 'max results per label type (default: 20)',
    parse: (v: string) => parseInt(v, 10),
  },
} satisfies OptionGroupOf<SearchLabelsOptions>;

export interface ListLabelsOptions {
  mediaId: string;
  /** Label types to list. Defaults to all types. */
  types?: LabelType[];
  /** Only labels attributed to this Entity (resolved record id). */
  entityId?: string;
  /** Max results per label type. Defaults to 100. */
  limit?: number;
  /** Only labels overlapping this source-media window (seconds); either edge may be open. */
  window?: { start?: number; end?: number };
}

/** List a media's labels, grouped by type and ordered by start time. */
export async function listLabels(
  pb: TypedPocketBase,
  opts: ListLabelsOptions
): Promise<{ hits: LabelHit[]; totalItems: number }> {
  const types = opts.types ?? Object.values(LabelType);
  const limit = opts.limit ?? 100;
  const clauses = ['MediaRef = {:media}'];
  const params: Record<string, string | number> = { media: opts.mediaId };
  if (opts.window?.end !== undefined) {
    clauses.push('start < {:wEnd}');
    params.wEnd = opts.window.end;
  }
  if (opts.window?.start !== undefined) {
    clauses.push('end > {:wStart}');
    params.wStart = opts.window.start;
  }

  const results = await Promise.all(
    types.map(async (type) => {
      const typeClauses = opts.entityId
        ? [...clauses, labelAttributionFilter(type, opts.entityId)]
        : clauses;
      const filter = pb.filter(typeClauses.join(' && '), params);
      const result = await labelMutator(pb, type).getList(
        1,
        limit,
        filter,
        'start',
        attributionExpands(type)
      );
      return { type, result };
    })
  );

  const hits: LabelHit[] = results.flatMap(({ type, result }) =>
    result.items.map((record) => toLabelHit(type, record))
  );
  const totalItems = results.reduce(
    (sum, { result }) => sum + result.totalItems,
    0
  );
  return { hits, totalItems };
}

/** A clip's played edit list resolved for label filtering. */
export interface ClipEditListFilter {
  mediaId: string;
  /** The windowed edit list — the source ranges the clip actually plays. */
  segments: CompositeSegment[];
  source: EditListSource;
}

/**
 * Resolve the played edit list of a MediaClip or TimelineClip for
 * `label list --clip/--timeline-clip`: the clip supplies its media and the
 * windowed segments labels must overlap to count as played.
 */
export async function clipEditListFilter(
  pb: TypedPocketBase,
  ref: { clip?: string; timelineClip?: string }
): Promise<ClipEditListFilter> {
  if (ref.clip) {
    const clip = await new MediaClipMutator(pb).getById(ref.clip);
    if (!clip) throw new Error(`Media clip not found: ${ref.clip}`);
    const existing = getCompositeSegments(clip);
    const list = existing?.length
      ? existing
      : [{ start: clip.start, end: clip.end }];
    return {
      mediaId: clip.MediaRef,
      segments: windowCompositeSegments(list, clip.start, clip.end),
      source: existing?.length ? 'clipData' : 'trim',
    };
  }
  const clipId = ref.timelineClip;
  if (!clipId) {
    throw new Error('Pass a MediaClip id (--clip) or TimelineClip id.');
  }
  const clip = await new TimelineClipMutator(pb).getById(clipId);
  if (!clip) throw new Error(`Timeline clip not found: ${clipId}`);
  if (!clip.MediaRef) {
    throw new Error(
      `Clip ${clipId} has no source media — captions and nested timelines have no labels.`
    );
  }
  const editList = await resolveTimelineEditList(pb, clip);
  return {
    mediaId: clip.MediaRef,
    segments: windowCompositeSegments(editList.segments, clip.start, clip.end),
    source: editList.source,
  };
}

/**
 * Fetch one label record; null when it does not exist (or type mismatch).
 * Rides the attribution expands so the attributed Entity resolves for
 * display (`label show`) without a second query.
 */
export async function getLabel(
  pb: TypedPocketBase,
  type: LabelType,
  labelId: string
): Promise<LabelRecord | null> {
  return labelMutator(pb, type).getById(labelId, attributionExpands(type));
}

export interface CreateClipFromLabelOptions {
  type: LabelType;
  labelId: string;
  /** Editor-facing clip name (searchable). */
  label?: string;
  /** Editor-facing clip notes (searchable). */
  description?: string;
}

/** `label clip` flags for the optional MediaClip fields above. */
export const clipMetaOptions = {
  label: {
    flags: '--label <text>',
    description: 'clip name shown in the editor (searchable)',
  },
  description: {
    flags: '--description <text>',
    description: 'clip notes shown in the editor (searchable)',
  },
} satisfies OptionGroupOf<CreateClipFromLabelOptions>;

/**
 * Create a MediaClip from a label row. The shared createFromLabel copies the
 * label's time range, maps its type to a ClipType, and records provenance
 * both in clipData and as a MediaClipLabels join row.
 */
export async function createClipFromLabel(
  pb: TypedPocketBase,
  opts: CreateClipFromLabelOptions
): Promise<{ clip: MediaClip; label: LabelRecord }> {
  const labelRecord = await getLabel(pb, opts.type, opts.labelId);
  if (!labelRecord) {
    throw new Error(
      `No ${opts.type} label with id ${opts.labelId} ` +
        `(a wrong type/id pairing also reads as not found — check the type)`
    );
  }

  const mutator = new MediaClipMutator(pb);
  let clip = await mutator.createFromLabel(labelRecord, opts.type, 'cli');

  const patch: Partial<MediaClip> = {};
  if (opts.label !== undefined) patch.label = opts.label;
  if (opts.description !== undefined) patch.description = opts.description;
  if (Object.keys(patch).length > 0) {
    clip = await mutator.update(clip.id, patch);
  }

  return { clip, label: labelRecord };
}
