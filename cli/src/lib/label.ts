import type { ListResult } from 'pocketbase';
import {
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
  clusterEntityAttributionFilter,
  entityAttributionFilter,
  speakerTranscriptLabel,
  type ActualizableLabel,
  type Entity,
  type MediaClip,
  type TypedPocketBase,
} from '@project/shared';
import { mediaLabel, type MediaWithUpload } from './select.js';
import type { OptionGroupOf } from './options.js';
import { truncate, type Column } from './output.js';

/**
 * A label row, possibly expanded with its media (and that media's upload)
 * and the two entity link points its attribution resolves through.
 */
export type LabelRecord = ActualizableLabel & {
  expand?: {
    MediaRef?: MediaWithUpload;
    LabelTrackRef?: { expand?: { EntityRef?: Entity } };
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
  /** Which link point resolved it: the row's own track, or its cluster. */
  via: 'track' | 'cluster';
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
 * The Entity a label row is attributed to, resolved from the expanded link
 * points with the model's precedence: the row's track link wins, the
 * provider cluster's link is the fallback. Null when unattributed (or when
 * the query didn't request the attribution expands).
 */
export function attributedEntityOf(record: LabelRecord): Entity | null {
  return (
    record.expand?.LabelTrackRef?.expand?.EntityRef ??
    record.expand?.LabelEntityRef?.expand?.EntityRef ??
    null
  );
}

/**
 * The attributed Entity as the compact summary label outputs embed, with
 * the link point it resolved through. Same precedence (and same null cases)
 * as attributedEntityOf.
 */
export function attributedEntitySummaryOf(
  record: LabelRecord
): AttributedEntity | null {
  const viaTrack = record.expand?.LabelTrackRef?.expand?.EntityRef;
  const entity = viaTrack ?? record.expand?.LabelEntityRef?.expand?.EntityRef;
  if (!entity) return null;
  return {
    id: entity.id,
    name: entity.name,
    kind: entity.kind,
    via: viaTrack ? 'track' : 'cluster',
  };
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
  /** Confidence field name — LabelFaces uses avgConfidence. */
  confidenceField: 'confidence' | 'avgConfidence';
  /** Short text for the MATCH/TEXT column. */
  snippet: (record: LabelRecord) => string;
  /**
   * Whether rows carry a LabelTrackRef link point. Shots and segments are
   * classifications, not tracked instances, so their only entity link is
   * the provider cluster — filters referencing LabelTrackRef would be a
   * PocketBase unknown-field error there.
   */
  hasTrack: boolean;
}

/** Per-type search contract: which fields a query matches, per collection. */
export const LABEL_TYPE_CONFIG: Record<LabelType, LabelTypeConfig> = {
  [LabelType.OBJECT]: {
    queryFields: ['entity'],
    confidenceField: 'confidence',
    hasTrack: true,
    snippet: (r) => textField(r, 'entity'),
  },
  [LabelType.SHOT]: {
    queryFields: ['entity'],
    confidenceField: 'confidence',
    hasTrack: false,
    snippet: (r) => textField(r, 'entity'),
  },
  [LabelType.PERSON]: {
    queryFields: ['upperBodyColor', 'lowerBodyColor'],
    confidenceField: 'confidence',
    hasTrack: true,
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
    confidenceField: 'confidence',
    hasTrack: true,
    snippet: (r) => textField(r, 'transcript'),
  },
  [LabelType.SPEAKER]: {
    queryFields: ['transcript', 'speakerId'],
    confidenceField: 'confidence',
    hasTrack: true,
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
    confidenceField: 'avgConfidence',
    hasTrack: true,
    snippet: (r) => textField(r, 'faceId') || textField(r, 'faceHash'),
  },
  [LabelType.SEGMENT]: {
    queryFields: ['entity'],
    confidenceField: 'confidence',
    hasTrack: false,
    snippet: (r) => textField(r, 'entity'),
  },
  [LabelType.TEXT]: {
    queryFields: ['text'],
    confidenceField: 'confidence',
    hasTrack: true,
    snippet: (r) => textField(r, 'text'),
  },
};

/**
 * PB filter matching one label type's rows attributed to an entity, using
 * the link points that type actually has (track > cluster, or cluster only).
 */
export function labelAttributionFilter(
  type: LabelType,
  entityId: string
): string {
  return LABEL_TYPE_CONFIG[type].hasTrack
    ? entityAttributionFilter(entityId)
    : clusterEntityAttributionFilter(entityId);
}

/**
 * Expand paths that resolve a label row's attributed Entity (for the ENTITY
 * column and speaker snippets): the row's track link and its provider
 * cluster's link, skipping LabelTrackRef where the collection lacks it.
 */
export function attributionExpands(type: LabelType): string[] {
  return LABEL_TYPE_CONFIG[type].hasTrack
    ? ['LabelTrackRef.EntityRef', 'LabelEntityRef.EntityRef']
    : ['LabelEntityRef.EntityRef'];
}

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
  const field = LABEL_TYPE_CONFIG[hit.type].confidenceField;
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

/**
 * Search a workspace's label collections. Fans out one bound-filter query per
 * label type (field names come from LABEL_TYPE_CONFIG, values are bound via
 * pb.filter), then merges hits best-confidence-first.
 */
export async function searchLabels(
  pb: TypedPocketBase,
  opts: SearchLabelsOptions
): Promise<{ hits: LabelHit[]; totalItems: number }> {
  const idFlags = (Object.keys(ID_FLAGS) as IdFlagKey[]).filter(
    (key) => opts[key] !== undefined
  );

  if (!opts.query && idFlags.length === 0 && !opts.entityId) {
    throw new Error(
      'Provide a search query, --entity, or an exact-id flag ' +
        '(--face-id, --person-id, --track-id)'
    );
  }

  const impliedTypes = [...new Set(idFlags.map((key) => ID_FLAGS[key].type))];
  if (opts.types && impliedTypes.length > 0) {
    const sameSet =
      opts.types.length === impliedTypes.length &&
      impliedTypes.every((t) => opts.types!.includes(t));
    if (!sameSet) {
      throw new Error(
        `--types ${opts.types.join(',')} conflicts with ${idFlags
          .map((key) => ID_FLAGS[key].flag)
          .join('/')} (implies --types ${impliedTypes.join(',')})`
      );
    }
  }
  const types =
    impliedTypes.length > 0
      ? impliedTypes
      : (opts.types ?? Object.values(LabelType));

  const limit = opts.limit ?? 20;
  const results = await Promise.all(
    types.map(async (type) => {
      const config = LABEL_TYPE_CONFIG[type];
      const clauses: string[] = ['WorkspaceRef = {:ws}'];
      const params: Record<string, string | number> = {
        ws: opts.workspaceId,
      };

      if (opts.media) {
        clauses.push('MediaRef = {:media}');
        params.media = opts.media;
      }
      if (opts.query) {
        clauses.push(
          `(${config.queryFields.map((f) => `${f} ~ {:q}`).join(' || ')})`
        );
        params.q = opts.query;
      }
      for (const key of idFlags) {
        if (ID_FLAGS[key].type === type) {
          clauses.push(`${ID_FLAGS[key].field} = {:${key}}`);
          params[key] = opts[key]!;
        }
      }
      if (opts.minConfidence !== undefined) {
        clauses.push(`${config.confidenceField} >= {:minConfidence}`);
        params.minConfidence = opts.minConfidence;
      }
      if (opts.entityId) {
        // Record-id from resolveEntity, so safe to embed directly (the
        // shared attribution filters are string templates, not bound).
        clauses.push(labelAttributionFilter(type, opts.entityId));
      }

      const filter = pb.filter(clauses.join(' && '), params);
      const result = await labelMutator(pb, type).getList(
        1,
        limit,
        filter,
        `-${config.confidenceField}`,
        ['MediaRef.UploadRef', ...attributionExpands(type)]
      );
      return { type, result };
    })
  );

  const hits: LabelHit[] = results.flatMap(({ type, result }) =>
    result.items.map((record) => toLabelHit(type, record))
  );
  hits.sort((a, b) => confidenceOf(b) - confidenceOf(a));
  const totalItems = results.reduce(
    (sum, { result }) => sum + result.totalItems,
    0
  );
  return { hits, totalItems };
}

export interface ListLabelsOptions {
  mediaId: string;
  /** Label types to list. Defaults to all types. */
  types?: LabelType[];
  /** Only labels attributed to this Entity (resolved record id). */
  entityId?: string;
  /** Max results per label type. Defaults to 100. */
  limit?: number;
  /** Only labels overlapping this source-media window (seconds). */
  window?: { start: number; end: number };
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
  if (opts.window) {
    clauses.push('start < {:wEnd} && end > {:wStart}');
    params.wStart = opts.window.start;
    params.wEnd = opts.window.end;
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
