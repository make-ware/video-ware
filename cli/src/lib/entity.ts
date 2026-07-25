import { InvalidArgumentError } from 'commander';
import {
  EntityKind,
  EntityMutator,
  LabelEntityMutator,
  LabelSpeakerMutator,
  LabelTrackMutator,
  LabelType,
  MediaTagMutator,
  entityAttributionFilter,
  trackEntityAttributionFilter,
  type Entity,
  type LabelEntity,
  type LabelSpeaker,
  type LabelTrack,
  type MediaTag,
  type TypedPocketBase,
} from '@project/shared';
import {
  LABEL_LIST_SORTS,
  attributionExpands,
  hitColumns,
  labelAttributionFilter,
  labelMutator,
  parseLabelType,
  parseLabelTypes,
  toLabelHit,
  type LabelHit,
} from './label.js';
import { mediaLabel, type MediaWithUpload } from './select.js';
import type { OptionGroupOf } from './options.js';
import type { ListResult } from 'pocketbase';
import { formatDuration, truncate } from './output.js';
import {
  ENTITY_SORTS,
  LABEL_RANGE_SORTS,
  listFilter,
  type ListSpec,
} from './list/index.js';

/** Validate an entity kind string against the EntityKind enum. */
export function parseEntityKind(value: string): EntityKind {
  const kinds = Object.values(EntityKind) as string[];
  if (!kinds.includes(value)) {
    throw new InvalidArgumentError(
      `Invalid entity kind "${value}". Valid kinds: ${kinds.join(', ')}`
    );
  }
  return value as EntityKind;
}

/** Parse a comma-separated alias list. */
export function parseAliases(value: string): string[] {
  return value
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean);
}

/**
 * Resolve an entity by record id or name: id lookup first, then exact name,
 * then fuzzy search (unambiguous single hit only).
 */
export async function resolveEntity(
  pb: TypedPocketBase,
  workspaceId: string,
  ref: string
): Promise<Entity> {
  const mutator = new EntityMutator(pb);

  const byId = await mutator.getById(ref);
  if (byId && byId.WorkspaceRef === workspaceId) return byId;

  const byName = await mutator.getByName(workspaceId, ref);
  if (byName) return byName;

  const fuzzy = await mutator.search(workspaceId, ref, 1, 5);
  if (fuzzy.items.length === 1) return fuzzy.items[0];
  if (fuzzy.items.length > 1) {
    const candidates = fuzzy.items
      .map((e) => `${e.name} (${e.kind}, ${e.id})`)
      .join(', ');
    throw new Error(
      `Entity "${ref}" is ambiguous — matches: ${candidates}. Use the id.`
    );
  }
  throw new Error(
    `No entity matching "${ref}" — vw entity list shows this workspace's entities`
  );
}

/** A label row's media expand, when the query requested MediaRef.UploadRef. */
type WithMediaExpand = { expand?: { MediaRef?: MediaWithUpload } };

/** Human-readable media name off an expanded row, falling back to the id. */
export function mediaNameOf(
  record: { MediaRef?: string } & WithMediaExpand
): string {
  const media = record.expand?.MediaRef;
  return media ? mediaLabel(media) : (record.MediaRef ?? '');
}

/**
 * Link targets accepted by `vw entity link` / `unlink`. Every form resolves
 * to one of the two link points of the data model:
 *   - LabelTrack.EntityRef (per-media instance: faces, speakers, objects…)
 *   - LabelEntity.EntityRef (workspace-wide provider cluster)
 */
export interface LinkTargetOptions {
  /** LabelTrack record ids. */
  track?: string[];
  /** LabelEntity (provider cluster) record ids. */
  cluster?: string[];
  /** `type:labelId` pairs — links the label row's own track. */
  label?: string[];
  /** `mediaId:speakerId` — links that speaker's track in that media. */
  speaker?: string;
  /** `mediaId:trackId` — links that face/object track in that media. */
  face?: string;
}

/** `entity link`/`entity unlink` flags for LinkTargetOptions. */
export const linkTargetOptions = {
  track: {
    flags: '--track <ids>',
    description: 'comma-separated LabelTrack record ids',
    parse: (v: string) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
  },
  cluster: {
    flags: '--cluster <ids>',
    description:
      'comma-separated LabelEntity (provider cluster) record ids — links every label in the cluster, across all media',
    parse: (v: string) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
  },
  label: {
    flags: '--label <pairs>',
    description:
      "comma-separated type:labelId pairs (e.g. face:abc123) — links each label row's track",
    parse: (v: string) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
  },
  speaker: {
    flags: '--speaker <mediaId:speakerId>',
    description: 'link one diarized speaker in one media (e.g. m1:speaker_0)',
  },
  face: {
    flags: '--face <mediaId:trackId>',
    description: 'link one face track in one media',
  },
} satisfies OptionGroupOf<LinkTargetOptions>;

/** Split a required `a:b` pair argument. */
function splitPair(value: string, flag: string): [string, string] {
  const idx = value.indexOf(':');
  if (idx <= 0 || idx === value.length - 1) {
    throw new Error(`${flag} expects <mediaId>:<providerId>, got "${value}"`);
  }
  return [value.slice(0, idx), value.slice(idx + 1)];
}

/** Find the LabelTrack for a provider track id within one media. */
async function trackByMediaAndTrackId(
  pb: TypedPocketBase,
  mediaId: string,
  trackId: string
): Promise<LabelTrack> {
  const track = await new LabelTrackMutator(pb).getFirstByFilter(
    pb.filter('MediaRef = {:media} && trackId = {:trackId}', {
      media: mediaId,
      trackId,
    }),
    undefined,
    '-created'
  );
  if (!track) {
    throw new Error(
      `No label track "${trackId}" in media ${mediaId} — ` +
        `vw label list -m ${mediaId} shows its labels`
    );
  }
  return track;
}

/** Resolve a `type:labelId` pair to that label row's LabelTrack id. */
async function trackOfLabelPair(
  pb: TypedPocketBase,
  pair: string
): Promise<string> {
  const [typeArg, labelId] = splitPair(pair, '--label');
  const type = parseLabelType(typeArg);
  const record = await labelMutator(pb, type).getById(labelId);
  if (!record) {
    throw new Error(`No ${type} label with id ${labelId}`);
  }
  const trackRef = (record as Record<string, unknown>).LabelTrackRef;
  if (typeof trackRef !== 'string' || !trackRef) {
    throw new Error(
      `${type} label ${labelId} has no track — link its provider cluster ` +
        `instead (vw entity link <entity> --cluster <labelEntityId>), or ` +
        `let vw label tag ${type} ${labelId} <entity> resolve that for you`
    );
  }
  return trackRef;
}

/** What `tagLabel` wrote: which link point the tag landed on, and its name. */
export interface TagLabelResult {
  type: LabelType;
  labelId: string;
  /** 'track': this instance across one media; 'cluster': workspace-wide. */
  via: 'track' | 'cluster';
  /** Record id of the LabelTrack / LabelEntity that was written. */
  targetId: string;
  /** Provider trackId (via=track) or cluster canonicalName (via=cluster). */
  targetName: string;
}

/**
 * Tag (or, with null, untag) the Entity a label row is attributed to. Tags
 * live on the row's link points, never on the row itself: its track when it
 * has one (identifies that speaker/face/object across the whole media),
 * else its provider cluster (applies to every label in the cluster,
 * workspace-wide). Link points are stable across label re-runs, so tags
 * survive regeneration and always resolve live.
 */
export async function tagLabel(
  pb: TypedPocketBase,
  type: LabelType,
  labelId: string,
  entityId: string | null
): Promise<TagLabelResult> {
  const record = await labelMutator(pb, type).getById(labelId);
  if (!record) {
    throw new Error(
      `No ${type} label with id ${labelId} ` +
        `(a wrong type/id pairing also reads as not found — check the type)`
    );
  }
  const row = record as Record<string, unknown>;

  const trackRef = row.LabelTrackRef;
  if (typeof trackRef === 'string' && trackRef) {
    const track = await new LabelTrackMutator(pb).setEntity(trackRef, entityId);
    return {
      type,
      labelId,
      via: 'track',
      targetId: track.id,
      targetName: track.trackId,
    };
  }

  const clusterRef = row.LabelEntityRef;
  if (typeof clusterRef === 'string' && clusterRef) {
    const cluster = await new LabelEntityMutator(pb).setEntity(
      clusterRef,
      entityId
    );
    return {
      type,
      labelId,
      via: 'cluster',
      targetId: cluster.id,
      targetName: cluster.canonicalName,
    };
  }

  throw new Error(
    `${type} label ${labelId} has neither a track nor a provider cluster — ` +
      `nothing to attach an entity tag to`
  );
}

/** The two concrete link points a set of target options resolves to. */
export interface ResolvedLinkTargets {
  trackIds: string[];
  clusterIds: string[];
}

/** Resolve every accepted target form to track and cluster record ids. */
export async function resolveLinkTargets(
  pb: TypedPocketBase,
  opts: LinkTargetOptions
): Promise<ResolvedLinkTargets> {
  const trackIds: string[] = [...(opts.track ?? [])];
  const clusterIds: string[] = [...(opts.cluster ?? [])];

  for (const pair of opts.label ?? []) {
    trackIds.push(await trackOfLabelPair(pb, pair));
  }
  for (const [flag, value] of [
    ['--speaker', opts.speaker],
    ['--face', opts.face],
  ] as const) {
    if (!value) continue;
    const [mediaId, providerId] = splitPair(value, flag);
    trackIds.push((await trackByMediaAndTrackId(pb, mediaId, providerId)).id);
  }

  if (trackIds.length === 0 && clusterIds.length === 0) {
    throw new Error(
      'Provide at least one target: --track, --cluster, --label, --speaker, or --face'
    );
  }
  return {
    trackIds: [...new Set(trackIds)],
    clusterIds: [...new Set(clusterIds)],
  };
}

/**
 * Point every resolved target at the entity (or clear the link when
 * entityId is null). Returns what was written, for reporting.
 */
export async function applyEntityLinks(
  pb: TypedPocketBase,
  entityId: string | null,
  targets: ResolvedLinkTargets
): Promise<{ tracks: LabelTrack[]; clusters: LabelEntity[] }> {
  const trackMutator = new LabelTrackMutator(pb);
  const clusterMutator = new LabelEntityMutator(pb);
  const tracks = await Promise.all(
    targets.trackIds.map((id) => trackMutator.setEntity(id, entityId))
  );
  const clusters = await Promise.all(
    targets.clusterIds.map((id) => clusterMutator.setEntity(id, entityId))
  );
  return { tracks, clusters };
}

/** One appearance of an entity: a linked track's range in one media. */
export interface EntityAppearance {
  track: LabelTrack & {
    expand?: { MediaRef?: MediaWithUpload; LabelEntityRef?: LabelEntity };
  };
  mediaName: string;
  /** Label type of the track's provider cluster ("face", "speaker", …). */
  labelType: string;
  /** "track" when the track itself is linked, "cluster" when inherited. */
  via: 'track' | 'cluster';
}

/**
 * `entity list` (and its optional positional query). Kind and search are both
 * server-side filters, so the footer's total always matches the rows shown —
 * the previous version filtered by kind in JS while reporting the unfiltered
 * server total.
 */
export const entityListSpec: ListSpec<Entity> = {
  command: 'entity list',
  sorts: ENTITY_SORTS,
  filters: {
    kind: listFilter({
      flags: '-k, --kind <kind>',
      description: `only this kind (${Object.values(EntityKind).join(', ')})`,
      parse: (raw) => parseEntityKind(raw),
      clause: (kind) => ({ expr: 'kind = {:k}', params: { k: kind } }),
    }),
    search: listFilter({
      flags: '--search <text>',
      description: "match the entity's name, aliases, or description",
      clause: (q) => ({
        expr: '(name ~ {:q} || aliases ~ {:q} || description ~ {:q})',
        params: { q },
      }),
    }),
  },
  columns: [
    { header: 'ID', value: (e) => e.id },
    { header: 'KIND', value: (e) => String(e.kind) },
    { header: 'NAME', value: (e) => e.name },
    { header: 'DESCRIPTION', value: (e) => truncate(e.description ?? '', 50) },
  ],
  hint: '`vw entity show <name|id>` shows links and appearances',
};

/** Fetch one page of entities for `entityListSpec`. */
export function fetchEntityPage(
  pb: TypedPocketBase,
  query: { page: number; perPage: number; filter: string; sort: string }
): Promise<ListResult<Entity>> {
  return new EntityMutator(pb).getList(
    query.page,
    query.perPage,
    query.filter,
    query.sort
  );
}

/** A media-scoped filter shared by the entity sub-listings. */
export const entityMediaFilter = listFilter({
  flags: '-m, --media <id>',
  description: 'restrict to one media',
  clause: (id) => ({ expr: 'MediaRef = {:m}', params: { m: id } }),
});

/**
 * `entity appearances` — when an entity is on screen or speaking, per media.
 *
 * Entity-scoped rather than workspace-scoped: the attribution filter depends
 * on the entity resolved from the positional argument, so the fetcher ANDs it
 * in (see `fetchEntityAppearancePage`) and the spec declares only what the
 * caller can vary.
 */
export const entityAppearancesSpec: ListSpec<LabelTrack, EntityAppearance> = {
  command: 'entity appearances',
  workspaceScoped: false,
  sorts: LABEL_RANGE_SORTS,
  filters: { media: entityMediaFilter },
  toRows: (tracks) => tracks.map(toEntityAppearance),
  columns: [
    { header: 'MEDIA', value: (a) => a.mediaName },
    { header: 'TYPE', value: (a) => a.labelType || '?' },
    { header: 'TRACK', value: (a) => a.track.trackId },
    { header: 'START', value: (a) => `${a.track.start.toFixed(2)}s` },
    { header: 'END', value: (a) => `${a.track.end.toFixed(2)}s` },
    { header: 'DUR', value: (a) => formatDuration(a.track.duration) },
    { header: 'VIA', value: (a) => a.via },
  ],
  hint: '`vw label clip <type> <labelId>` turns a label into a clip',
};

/** Fetch one page of an entity's appearances. */
export function fetchEntityAppearancePage(
  pb: TypedPocketBase,
  entityId: string,
  query: { page: number; perPage: number; filter: string; sort: string }
): Promise<ListResult<LabelTrack>> {
  return new LabelTrackMutator(pb).getList(
    query.page,
    query.perPage,
    andFilters(trackEntityAttributionFilter(entityId), query.filter),
    query.sort,
    ['MediaRef.UploadRef', 'LabelEntityRef']
  ) as Promise<ListResult<LabelTrack>>;
}

/**
 * `entity words` — everything an entity said, across media. Entity-scoped in
 * the same way as `entity appearances`.
 */
export const entityWordsSpec: ListSpec<EntityUtterance> = {
  command: 'entity words',
  workspaceScoped: false,
  sorts: LABEL_RANGE_SORTS,
  filters: { media: entityMediaFilter },
  columns: [
    { header: 'MEDIA', value: (u) => mediaNameOf(u) },
    { header: 'START', value: (u) => `${u.start.toFixed(2)}s` },
    { header: 'END', value: (u) => `${u.end.toFixed(2)}s` },
    { header: 'TEXT', value: (u) => truncate(u.transcript, 70) },
  ],
  hint: 'add --text for a plain transcript',
};

/** Fetch one page of an entity's utterances. */
export function fetchEntityWordsPage(
  pb: TypedPocketBase,
  entityId: string,
  query: { page: number; perPage: number; filter: string; sort: string }
): Promise<ListResult<EntityUtterance>> {
  return new LabelSpeakerMutator(pb).getList(
    query.page,
    query.perPage,
    andFilters(entityAttributionFilter(entityId), query.filter),
    query.sort,
    ['MediaRef.UploadRef']
  ) as Promise<ListResult<EntityUtterance>>;
}

/** Combine a required scope clause with the resolved filter, if any. */
function andFilters(scope: string, filter: string): string {
  return filter ? `(${scope}) && (${filter})` : scope;
}

/**
 * Map a LabelTrack to its display shape for `entity appearances`.
 *
 * `via` needs no entity id: `trackEntityAttributionFilter` encodes the
 * track-over-cluster precedence as
 * `EntityRef = id || (EntityRef = "" && cluster = id)`, so every row it
 * returns has `EntityRef` either set to the entity asked about or empty.
 */
function toEntityAppearance(track: LabelTrack): EntityAppearance {
  const t = track as EntityAppearance['track'];
  const labelType = t.expand?.LabelEntityRef?.labelType;
  return {
    track: t,
    mediaName: mediaNameOf(t),
    labelType: Array.isArray(labelType)
      ? labelType.join(',')
      : (labelType ?? ''),
    via: t.EntityRef ? 'track' : 'cluster',
  };
}

/**
 * Where (and when) an entity appears across the workspace's media: every
 * track attributed to it, one appearance range each.
 */
export async function getEntityAppearances(
  pb: TypedPocketBase,
  entityId: string,
  opts: { media?: string; limit?: number } = {}
): Promise<{ appearances: EntityAppearance[]; totalItems: number }> {
  const clauses = [trackEntityAttributionFilter(entityId)];
  if (opts.media) {
    clauses.push(pb.filter('MediaRef = {:media}', { media: opts.media }));
  }
  const result = await new LabelTrackMutator(pb).getList(
    1,
    opts.limit ?? 100,
    clauses.join(' && '),
    'MediaRef,start',
    ['MediaRef.UploadRef', 'LabelEntityRef']
  );

  const appearances = result.items.map((track) => {
    const t = track as EntityAppearance['track'];
    const labelType = t.expand?.LabelEntityRef?.labelType;
    return {
      track: t,
      mediaName: mediaNameOf(t),
      labelType: Array.isArray(labelType)
        ? labelType.join(',')
        : (labelType ?? ''),
      via: (t.EntityRef === entityId ? 'track' : 'cluster') as
        | 'track'
        | 'cluster',
    };
  });
  return { appearances, totalItems: result.totalItems };
}

/** One media manually tagged with an entity (a whole-media MediaTags edge). */
export interface EntityTaggedMedia {
  tagId: string;
  mediaId: string;
  mediaName: string;
  mediaType: string;
  duration: number;
}

/**
 * Media manually tagged with the entity ("this media features X") — the
 * whole-media MediaTags edges, distinct from track/cluster attribution.
 * Newest tags first.
 */
export async function getEntityTaggedMedia(
  pb: TypedPocketBase,
  entityId: string,
  limit = 100
): Promise<{ tagged: EntityTaggedMedia[]; totalItems: number }> {
  const result = await new MediaTagMutator(pb).getList(
    1,
    limit,
    `EntityRef = "${entityId}"`,
    '-created',
    ['MediaRef.UploadRef']
  );
  const tagged = result.items.map((tag) => {
    const row = tag as MediaTag & WithMediaExpand;
    const media = row.expand?.MediaRef;
    return {
      tagId: tag.id,
      mediaId: tag.MediaRef,
      mediaName: mediaNameOf(row),
      mediaType: media ? String(media.mediaType) : '?',
      duration: media?.duration ?? 0,
    };
  });
  return { tagged, totalItems: result.totalItems };
}

/**
 * `entity labels` — every label attributed to an entity, across every label
 * collection. A fan-out like `label search`, but the selector is the entity
 * from the positional argument rather than a query, so the attribution clause
 * is supplied per type by the command.
 */
export const entityLabelsSpec: ListSpec<LabelHit> = {
  command: 'entity labels',
  workspaceScoped: false,
  sorts: LABEL_LIST_SORTS,
  filters: {
    media: entityMediaFilter,
    types: listFilter({
      flags: '-t, --types <types>',
      description: `comma-separated label types (${Object.values(LabelType).join(', ')}; default: all)`,
      parse: parseLabelTypes,
      clause: () => null,
    }),
    minConfidence: listFilter({
      flags: '--min-confidence <n>',
      description: 'minimum confidence (0..1)',
      parse: parseFloat,
      clause: () => null,
    }),
  },
  columns: hitColumns(true),
  hint: '`vw label clip <type> <labelId>` turns a label into a clip',
};

export interface EntityLabelsOptions {
  /** Label types to include. Defaults to all types. */
  types?: LabelType[];
  /** Restrict to one media. */
  media?: string;
  /** Max rows per label type. Defaults to 100. */
  limit?: number;
}

/**
 * Every label attributed to an entity, across label types: rows whose track
 * (preferred) or provider cluster is linked to it. One query per type with
 * that type's attribution filter — shot/segment rows have no track, so
 * theirs matches on the cluster link alone — merged in media/start order.
 */
export async function getEntityLabels(
  pb: TypedPocketBase,
  entityId: string,
  opts: EntityLabelsOptions = {}
): Promise<{ hits: LabelHit[]; totalItems: number }> {
  const types = opts.types ?? Object.values(LabelType);
  const limit = opts.limit ?? 100;

  const results = await Promise.all(
    types.map(async (type) => {
      const clauses = [labelAttributionFilter(type, entityId)];
      if (opts.media) {
        clauses.push(pb.filter('MediaRef = {:media}', { media: opts.media }));
      }
      const result = await labelMutator(pb, type).getList(
        1,
        limit,
        clauses.join(' && '),
        'MediaRef,start',
        ['MediaRef.UploadRef', ...attributionExpands(type)]
      );
      return { type, result };
    })
  );

  const hits: LabelHit[] = results.flatMap(({ type, result }) =>
    result.items.map((record) => toLabelHit(type, record))
  );
  hits.sort(
    (a, b) =>
      a.record.MediaRef.localeCompare(b.record.MediaRef) ||
      a.record.start - b.record.start
  );
  const totalItems = results.reduce(
    (sum, { result }) => sum + result.totalItems,
    0
  );
  return { hits, totalItems };
}

/** One utterance attributed to an entity, with its media expanded. */
export type EntityUtterance = LabelSpeaker & {
  expand?: { MediaRef?: MediaWithUpload };
};

/**
 * Everything an entity said, across media: LabelSpeaker rows whose track
 * (preferred) or provider cluster is linked to it, in media/start order.
 */
export async function getEntityWords(
  pb: TypedPocketBase,
  entityId: string,
  opts: { media?: string; limit?: number } = {}
): Promise<{ utterances: EntityUtterance[]; totalItems: number }> {
  const clauses = [entityAttributionFilter(entityId)];
  if (opts.media) {
    clauses.push(pb.filter('MediaRef = {:media}', { media: opts.media }));
  }
  const result = await new LabelSpeakerMutator(pb).getList(
    1,
    opts.limit ?? 200,
    clauses.join(' && '),
    'MediaRef,start',
    ['MediaRef.UploadRef']
  );
  return {
    utterances: result.items as EntityUtterance[],
    totalItems: result.totalItems,
  };
}

/**
 * Plain-text transcript of an entity's utterances, grouped by media:
 * consecutive utterances merge into paragraphs under a `== media ==` header.
 */
export function formatEntityTranscript(utterances: EntityUtterance[]): string {
  const blocks: string[] = [];
  let currentMedia: string | null = null;
  for (const u of utterances) {
    if (u.MediaRef !== currentMedia) {
      blocks.push(`== ${mediaNameOf(u)} ==`);
      currentMedia = u.MediaRef;
    }
    blocks.push(u.transcript);
  }
  return blocks.join('\n\n');
}

/** Media referenced by an appearance/utterance list, deduped in order. */
export function distinctMedia(
  rows: Array<{ MediaRef?: string } & WithMediaExpand>
): Array<{ id: string; name: string }> {
  const seen = new Map<string, string>();
  for (const row of rows) {
    const id = row.MediaRef ?? '';
    if (id && !seen.has(id)) seen.set(id, mediaNameOf(row));
  }
  return [...seen.entries()].map(([id, name]) => ({ id, name }));
}
