import { InvalidArgumentError } from 'commander';
import type { ListResult } from 'pocketbase';
import {
  LABEL_TRACK_TYPE_VALUES,
  LabelTrackMutator,
  MediaMutator,
  TRACK_KEYFRAME_FIELDS,
  TRACK_SUMMARY_FIELDS,
  bboxArea,
  bboxCenter,
  bboxIntersects,
  bboxToPixels,
  decimateKeyframes,
  entityAttributionFilter,
  interpolateBbox,
  mediaDisplayDimensions,
  normalizeKeyframes,
  roundKeyframe,
  sampleKeyframes,
  unionBbox,
  type Bbox,
  type Entity,
  type Keyframe,
  type LabelEntity,
  type LabelTrack,
  type LabelType,
  type PixelBox,
  type TypedPocketBase,
} from '@project/shared';
import { mediaLabel, type MediaWithUpload } from './select.js';
import { LABEL_RANGE_SORTS, listFilter } from './list/index.js';
import type { ListSpec, SortRegistry } from './list/index.js';
import { formatDuration, truncate } from './output.js';

/**
 * Reading `LabelTrack` — the per-frame tracking geometry — from the CLI.
 *
 * One rule shapes every function here: **the cheap read is the default and the
 * expensive read is explicit.** `keyframes` is capped at 10 MB per row and a
 * media routinely carries hundreds of tracks, so listing, showing, and
 * filtering all run off `TRACK_SUMMARY_FIELDS` (every column except
 * `keyframes`), and the heavy column is pulled one track at a time, only by the
 * commands that genuinely need per-frame data.
 *
 * Storage contract worth keeping in mind while reading this file: keyframe `t`
 * values are **absolute media seconds** (the first equals `track.start`), and
 * every bbox coordinate is a **0–1 fraction of the frame**. `--pixels` and
 * `--relative` convert at the edge, never in the middle.
 */

/** A track with the relations the summary projection can carry. */
export type TrackRecord = LabelTrack & {
  expand?: {
    MediaRef?: MediaWithUpload;
    LabelEntityRef?: LabelEntity & { expand?: { EntityRef?: Entity } };
  };
};

/** Expand paths every track read requests; all four survive the projection. */
export const TRACK_EXPANDS = ['MediaRef.UploadRef', 'LabelEntityRef.EntityRef'];

/** Rows per page while walking tracks in the export's cheap first phase. */
const TRACK_PAGE_SIZE = 200;

/** Keyframes `track show` prints when the caller does not ask for more. */
export const DEFAULT_SHOW_FRAMES = 12;

/**
 * Ceiling on `track show --frames`. Past this the answer is `track export` —
 * a terminal is not a data sink, and the point of the digest is that it fits.
 */
export const MAX_SHOW_FRAMES = 200;

/** Tracks `track at` reports before it asks the caller to narrow. */
export const DEFAULT_AT_LIMIT = 20;

/**
 * Total keyframe rows `track export` will write without being asked twice.
 *
 * Sized so the default CSV lands around 35 MB — large enough that no realistic
 * single-media export trips it, small enough that a whole-entity export across
 * a big library stops and asks. The estimate is checked *before* any keyframe
 * request, so exceeding it costs nothing.
 */
export const DEFAULT_MAX_FRAMES = 500_000;

/** Decimal places `track export` rounds geometry to unless told otherwise. */
export const DEFAULT_PRECISION = 4;

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** Validate a track label kind (the six spatial kinds plus shot/segment). */
export function parseTrackType(value: string): LabelType {
  const types = LABEL_TRACK_TYPE_VALUES as readonly string[];
  if (!types.includes(value)) {
    throw new InvalidArgumentError(
      `Invalid track type "${value}". Valid types: ${types.join(', ')}`
    );
  }
  return value as LabelType;
}

/** Parse a positive integer flag (`--frames`, `--max-frames`). */
export function parsePositiveInt(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new InvalidArgumentError('expected a positive integer');
  }
  return n;
}

/** Parse a non-negative integer flag (`--precision`). */
export function parseNonNegativeInt(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new InvalidArgumentError('expected a non-negative integer');
  }
  return n;
}

/** Parse a positive rate in frames per second (`--fps`). */
export function parseFps(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new InvalidArgumentError('expected a positive number of frames/sec');
  }
  return n;
}

/**
 * Parse `left,top,right,bottom` as 0–1 fractions of the frame — the region a
 * spatial filter tests a track's union box against.
 */
export function parseRegion(value: string): Bbox {
  const parts = value.split(',').map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    throw new InvalidArgumentError(
      'expected left,top,right,bottom as 0-1 fractions (e.g. 0.5,0,1,0.5)'
    );
  }
  const [left, top, right, bottom] = parts;
  if (right <= left || bottom <= top) {
    throw new InvalidArgumentError(
      'expected left < right and top < bottom (e.g. 0.5,0,1,0.5)'
    );
  }
  return { left, top, right, bottom };
}

// ---------------------------------------------------------------------------
// Reading tracks
// ---------------------------------------------------------------------------

/** A track mutator that never fetches keyframes. */
export function summaryTracks(pb: TypedPocketBase): LabelTrackMutator {
  return new LabelTrackMutator(pb, { fields: [...TRACK_SUMMARY_FIELDS] });
}

/**
 * A track's per-frame geometry, as stored (absolute media seconds, 0–1 coords).
 *
 * The only read in the CLI that touches the heavy column, and it is deliberately
 * one track per call: a caller looping over tracks holds one track's keyframes
 * at a time rather than the whole result set.
 */
export async function fetchKeyframes(
  pb: TypedPocketBase,
  trackId: string
): Promise<Keyframe[]> {
  const row = await new LabelTrackMutator(pb, {
    fields: [...TRACK_KEYFRAME_FIELDS],
  }).getById(trackId);
  return normalizeKeyframes(row?.keyframes);
}

/** Load one track (summary only), refusing an id from another workspace. */
export async function requireTrack(
  pb: TypedPocketBase,
  trackId: string
): Promise<TrackRecord> {
  const track = (await summaryTracks(pb).getById(
    trackId,
    TRACK_EXPANDS as never
  )) as TrackRecord | null;
  if (!track) {
    throw new Error(
      `Track not found: ${trackId} ` +
        '(a LabelTrack record id — `vw track list -m <mediaId>` lists them)'
    );
  }
  return track;
}

/**
 * A track's union bounding box.
 *
 * Prefers the stored `boundingBox`, computed by the normalizers on the write
 * side, and falls back to deriving it from the keyframes the caller already
 * holds. The fallback is load-bearing rather than defensive: rows written
 * before the field was populated carry an empty one, so the read path has to be
 * correct without it.
 */
export function trackUnionBox(
  track: Pick<LabelTrack, 'boundingBox'>,
  keyframes: readonly Keyframe[] = []
): Bbox | null {
  const stored = track.boundingBox as Partial<Bbox> | null | undefined;
  if (
    stored &&
    typeof stored === 'object' &&
    typeof stored.left === 'number' &&
    typeof stored.top === 'number' &&
    typeof stored.right === 'number' &&
    typeof stored.bottom === 'number'
  ) {
    return {
      left: stored.left,
      top: stored.top,
      right: stored.right,
      bottom: stored.bottom,
    };
  }
  return unionBbox(keyframes);
}

/**
 * Frames a track holds, without reading one.
 *
 * `trackData.frameCount` is stamped by every spatial normalizer, so a listing
 * can report an honest count for zero keyframe bytes. Returns null when the
 * provider wrote no count — better a blank column than a confident zero.
 */
export function trackFrameCount(
  track: Pick<LabelTrack, 'trackData'>
): number | null {
  const data = track.trackData as Record<string, unknown> | null | undefined;
  const count = data?.frameCount;
  return typeof count === 'number' && Number.isFinite(count) ? count : null;
}

/** The provider's term for what a track is ("tableware", "Face", the OCR text). */
export function trackSubject(track: TrackRecord): string {
  const data = track.trackData as Record<string, unknown> | null | undefined;
  const entity = data?.entity;
  if (typeof entity === 'string' && entity) return entity;
  const speakerId = data?.speakerId;
  if (typeof speakerId === 'string' && speakerId) return speakerId;
  return track.expand?.LabelEntityRef?.canonicalName ?? '';
}

/** The real-world entity a track is attributed to, if any. */
export function trackEntity(track: TrackRecord): Entity | null {
  return track.expand?.LabelEntityRef?.expand?.EntityRef ?? null;
}

/** Human-readable media name off an expanded track, falling back to the id. */
export function trackMediaName(track: TrackRecord): string {
  const media = track.expand?.MediaRef;
  return media ? mediaLabel(media) : track.MediaRef;
}

/** Display frame size for a track's media — 0×0 when the media isn't expanded. */
export function trackFrameSize(track: TrackRecord): {
  width: number;
  height: number;
} {
  const media = track.expand?.MediaRef;
  if (!media) return { width: 0, height: 0 };
  const { width, height } = mediaDisplayDimensions(media);
  return { width, height };
}

// ---------------------------------------------------------------------------
// `vw track list`
// ---------------------------------------------------------------------------

/** Sort choices for track lists — the label range orders plus confidence. */
export const TRACK_SORTS: SortRegistry = [
  ...LABEL_RANGE_SORTS,
  {
    value: 'confidence',
    description: 'most confident first',
    pbSort: '-confidence,MediaRef,start,id',
  },
];

/** Filters shared by `track list` and `track export`, so the two stay aligned. */
export const trackScopeFilters = {
  media: listFilter({
    flags: '-m, --media <id>',
    description: 'tracks belonging to one media',
    clause: (id) => ({ expr: 'MediaRef = {:m}', params: { m: id } }),
  }),
  entity: listFilter({
    flags: '--entity <nameOrId>',
    description: 'only tracks attributed to this real-world entity',
    // Resolved by the command (a name needs a lookup) and ANDed in by the
    // fetcher, like `entity appearances` — the spec declares the flag so
    // --help, the requirement check, and the footer all see it.
    clause: () => null,
  }),
  track: listFilter({
    flags: '--track <trackId>',
    description: "the provider's track id within a media (e.g. 4, speaker_0)",
    clause: (id) => ({ expr: 'trackId = {:t}', params: { t: id } }),
  }),
  type: listFilter({
    flags: '-t, --type <labelType>',
    description: `only this track kind (${LABEL_TRACK_TYPE_VALUES.join(', ')})`,
    parse: parseTrackType,
    clause: (type) => ({ expr: 'labelType = {:lt}', params: { lt: type } }),
  }),
  from: listFilter({
    flags: '--from <seconds>',
    description: 'only tracks overlapping at/after this media time',
    parse: (raw) => Number(raw),
    clause: (start) => ({ expr: 'end > {:wStart}', params: { wStart: start } }),
  }),
  to: listFilter({
    flags: '--to <seconds>',
    description: 'only tracks overlapping before this media time',
    parse: (raw) => Number(raw),
    clause: (end) => ({ expr: 'start < {:wEnd}', params: { wEnd: end } }),
  }),
  minConfidence: listFilter({
    flags: '--min-confidence <n>',
    description: 'minimum track confidence (0..1)',
    parse: (raw) => Number(raw),
    clause: (min) => ({ expr: 'confidence >= {:mc}', params: { mc: min } }),
  }),
  minDuration: listFilter({
    flags: '--min-duration <seconds>',
    description: 'drop tracks shorter than this (single-frame noise)',
    parse: (raw) => Number(raw),
    clause: (min) => ({ expr: 'duration >= {:md}', params: { md: min } }),
  }),
};

/**
 * `vw track list` — a media's (or an entity's) tracks, summary only.
 *
 * `requireOneOf` rather than a workspace-wide default: object tracking alone
 * emits over a hundred tracks per dense minute, so an unscoped list would page
 * through thousands of rows to answer a question about one video. Being
 * specific beats paging, and the footer advertises the flags that get you there.
 *
 * Never reads keyframes. FRAMES comes from `trackData.frameCount` and BOX from
 * the stored union box, so the whole table is served by the summary projection.
 */
export const trackListSpec: ListSpec<TrackRecord> = {
  command: 'track list',
  sorts: TRACK_SORTS,
  requireOneOf: ['media', 'entity', 'track'],
  filters: {
    ...trackScopeFilters,
    region: listFilter({
      flags: '--region <l,t,r,b>',
      description:
        'only tracks whose union box overlaps this region of the frame ' +
        '(0-1 fractions, e.g. 0.5,0,1,0.5 for the top-right quadrant)',
      parse: parseRegion,
      // Not a server clause: `boundingBox` is JSON, so overlap is a predicate
      // over parsed values. Applied as a ListRefinement by the command.
      clause: () => null,
    }),
  },
  columns: [
    { header: 'ID', value: (t) => t.id },
    { header: 'TYPE', value: (t) => t.labelType || '?' },
    { header: 'TRACK', value: (t) => t.trackId },
    { header: 'SUBJECT', value: (t) => truncate(trackSubject(t), 24) },
    { header: 'ENTITY', value: (t) => trackEntity(t)?.name ?? '' },
    { header: 'START', value: (t) => `${t.start.toFixed(2)}s` },
    { header: 'END', value: (t) => `${t.end.toFixed(2)}s` },
    { header: 'DUR', value: (t) => formatDuration(t.duration) },
    { header: 'CONF', value: (t) => t.confidence.toFixed(2) },
    {
      header: 'FRAMES',
      value: (t) => {
        const count = trackFrameCount(t);
        return count === null ? '' : String(count);
      },
    },
  ],
  hint:
    '`vw track show <id>` for one track, `vw track at -m <mediaId> --at <s>` ' +
    'for what is on screen, `vw track export` for every frame',
};

/** Combine a required scope clause with the resolved filter, if any. */
export function andFilters(scope: string, filter: string): string {
  if (!scope) return filter;
  return filter ? `(${scope}) && (${filter})` : scope;
}

/** Fetch one page of tracks under the resolved query, summary fields only. */
export function fetchTrackPage(
  pb: TypedPocketBase,
  query: { page: number; perPage: number; filter: string; sort: string },
  entityId?: string
): Promise<ListResult<TrackRecord>> {
  return summaryTracks(pb).getList(
    query.page,
    query.perPage,
    andFilters(entityId ? entityAttributionFilter(entityId) : '', query.filter),
    query.sort,
    TRACK_EXPANDS as never
  ) as Promise<ListResult<TrackRecord>>;
}

/** Keep tracks whose union box overlaps `region`; unboxed tracks drop out. */
export function filterByRegion(
  tracks: TrackRecord[],
  region: Bbox
): TrackRecord[] {
  return tracks.filter((track) => {
    const box = trackUnionBox(track);
    return box ? bboxIntersects(box, region) : false;
  });
}

// ---------------------------------------------------------------------------
// `vw track show`
// ---------------------------------------------------------------------------

/** How a track's box moves from its first frame to its last. */
export interface TrackMotion {
  from: { x: number; y: number };
  to: { x: number; y: number };
  /** Fractional change in box area, first frame → last. */
  areaChange: number;
  /** Plain-language summary, e.g. "drifts left, grows". */
  description: string;
}

/** Describe a track's drift across its keyframes, or null when it can't move. */
export function trackMotion(
  keyframes: readonly Keyframe[]
): TrackMotion | null {
  if (keyframes.length < 2) return null;
  const first = keyframes[0];
  const last = keyframes[keyframes.length - 1];
  const from = bboxCenter(first.bbox);
  const to = bboxCenter(last.bbox);
  const startArea = bboxArea(first.bbox);
  const areaChange = startArea > 0 ? bboxArea(last.bbox) / startArea - 1 : 0;

  // 2% of the frame is roughly where drift stops being sampling noise.
  const parts: string[] = [];
  if (Math.abs(to.x - from.x) > 0.02) {
    parts.push(to.x > from.x ? 'drifts right' : 'drifts left');
  }
  if (Math.abs(to.y - from.y) > 0.02) {
    parts.push(to.y > from.y ? 'drifts down' : 'drifts up');
  }
  if (Math.abs(areaChange) > 0.1) {
    parts.push(areaChange > 0 ? 'grows' : 'shrinks');
  }
  return {
    from,
    to,
    areaChange,
    description: parts.length > 0 ? parts.join(', ') : 'holds position',
  };
}

/** Everything `track show` prints, and the `--json` document it returns. */
export interface TrackDigest {
  track: TrackRecord;
  mediaName: string;
  subject: string;
  entity: Entity | null;
  /** Union box, stored or derived. */
  union: Bbox | null;
  unionPixels: PixelBox | null;
  frame: { width: number; height: number };
  /** Frames actually stored, counted from the keyframes read. */
  frameCount: number;
  /** Keyframes per second across the track's span, or null when it can't be. */
  frameRate: number | null;
  motion: TrackMotion | null;
  /** The sampled subset shown; never the whole list. */
  samples: Keyframe[];
}

/**
 * Build a track's digest: identity, span, union box, drift, and an evenly
 * spread sample of its frames.
 *
 * Two reads — one summary, one keyframes — and the keyframe list never leaves
 * this function whole. A caller that wants every frame is asked to run
 * `vw track export`, which writes to a file.
 */
export async function getTrackDigest(
  pb: TypedPocketBase,
  trackId: string,
  opts: { frames?: number } = {}
): Promise<TrackDigest> {
  const requested = opts.frames ?? DEFAULT_SHOW_FRAMES;
  if (requested > MAX_SHOW_FRAMES) {
    throw new Error(
      `--frames ${requested} exceeds the ${MAX_SHOW_FRAMES}-frame ceiling for a ` +
        'terminal digest. `vw track export --track <trackId> -o frames.csv` ' +
        'writes every frame to a file instead.'
    );
  }

  const track = await requireTrack(pb, trackId);
  const keyframes = await fetchKeyframes(pb, trackId);
  const union = trackUnionBox(track, keyframes);
  const frame = trackFrameSize(track);
  const span = track.end - track.start;

  return {
    track,
    mediaName: trackMediaName(track),
    subject: trackSubject(track),
    entity: trackEntity(track),
    union,
    unionPixels: union ? bboxToPixels(union, frame.width, frame.height) : null,
    frame,
    frameCount: keyframes.length,
    frameRate:
      span > 0 && keyframes.length > 1 ? keyframes.length / span : null,
    motion: trackMotion(keyframes),
    samples: sampleKeyframes(keyframes, requested),
  };
}

// ---------------------------------------------------------------------------
// `vw track at`
// ---------------------------------------------------------------------------

/** One track that is live at an instant, with its interpolated box. */
export interface TrackAtTime {
  track: TrackRecord;
  subject: string;
  entity: Entity | null;
  bbox: Bbox;
  pixels: PixelBox | null;
  /** Frames stored for this track, from the keyframes read. */
  frameCount: number;
}

export interface TracksAtResult {
  mediaId: string;
  mediaName: string;
  at: number;
  frame: { width: number; height: number };
  hits: TrackAtTime[];
  /** Tracks live at `at` in total; `hits` may be a `--limit`-sized window. */
  totalLive: number;
  /** Live tracks that stored no spatial keyframes (speech/speaker). */
  withoutGeometry: number;
}

/**
 * Every track on screen at one media time, with its box interpolated between
 * the surrounding keyframes.
 *
 * Bounded by construction: the server returns only tracks spanning `at`, the
 * caller's limit caps how many of those get a keyframe read, and each read is
 * one track. Pairs with `vw frame -m <mediaId> --at <t>` to actually look at
 * what the boxes describe.
 *
 * Scoped by media (every live track) or by one track record id (just that one).
 */
export async function getTracksAt(
  pb: TypedPocketBase,
  opts: {
    mediaId?: string;
    trackRecordId?: string;
    at: number;
    type?: LabelType;
    minConfidence?: number;
    limit?: number;
  }
): Promise<TracksAtResult> {
  if (!opts.mediaId && !opts.trackRecordId) {
    throw new Error('track at needs -m <mediaId> or --track <labelTrackId>.');
  }
  const limit = opts.limit ?? DEFAULT_AT_LIMIT;
  const clauses = [pb.filter('start <= {:t} && end >= {:t}', { t: opts.at })];
  if (opts.mediaId) {
    clauses.push(pb.filter('MediaRef = {:m}', { m: opts.mediaId }));
  }
  if (opts.trackRecordId) {
    clauses.push(pb.filter('id = {:id}', { id: opts.trackRecordId }));
  }
  if (opts.type) {
    clauses.push(pb.filter('labelType = {:lt}', { lt: opts.type }));
  }
  if (opts.minConfidence !== undefined) {
    clauses.push(pb.filter('confidence >= {:mc}', { mc: opts.minConfidence }));
  }

  const live = (await summaryTracks(pb).getList(
    1,
    limit,
    clauses.join(' && '),
    '-confidence,id',
    TRACK_EXPANDS as never
  )) as ListResult<TrackRecord>;

  const media = live.items[0]?.expand?.MediaRef;
  const frame = media
    ? mediaDisplayDimensions(media)
    : { width: 0, height: 0, aspect: 0 };

  const hits: TrackAtTime[] = [];
  let withoutGeometry = 0;
  for (const track of live.items) {
    const keyframes = await fetchKeyframes(pb, track.id);
    const bbox = interpolateBbox(keyframes, opts.at);
    if (!bbox) {
      // Speech and speaker tracks store `keyframes: []` on purpose — they are
      // live at this time, they just have nothing spatial to report.
      withoutGeometry++;
      continue;
    }
    hits.push({
      track,
      subject: trackSubject(track),
      entity: trackEntity(track),
      bbox,
      pixels: bboxToPixels(bbox, frame.width, frame.height),
      frameCount: keyframes.length,
    });
  }

  const mediaId = opts.mediaId ?? live.items[0]?.MediaRef ?? '';
  return {
    mediaId,
    mediaName: media ? mediaLabel(media) : mediaId,
    at: opts.at,
    frame: { width: frame.width, height: frame.height },
    hits,
    totalLive: live.totalItems,
    withoutGeometry,
  };
}

// ---------------------------------------------------------------------------
// `vw track export`
// ---------------------------------------------------------------------------

export type TrackExportFormat = 'csv' | 'ndjson' | 'json';

export const TRACK_EXPORT_FORMATS: readonly TrackExportFormat[] = [
  'csv',
  'ndjson',
  'json',
];

/** Validate `--format`. */
export function parseExportFormat(value: string): TrackExportFormat {
  if (!(TRACK_EXPORT_FORMATS as readonly string[]).includes(value)) {
    throw new InvalidArgumentError(
      `Invalid format "${value}". Valid formats: ${TRACK_EXPORT_FORMATS.join(', ')}`
    );
  }
  return value as TrackExportFormat;
}

export interface TrackExportOptions {
  format: TrackExportFormat;
  /** Keep at most one frame per this many seconds. 0 keeps every frame. */
  every: number;
  /** Cap frames per track after decimation, sampled evenly. */
  maxFramesPerTrack?: number;
  /** Decimals for bbox/confidence. */
  precision: number;
  /** Emit whole pixels of the display frame instead of 0–1 fractions. */
  pixels: boolean;
  /** Emit `t` as an offset from the track's start instead of media time. */
  relative: boolean;
  /** Refuse the export above this many total frames. */
  maxFrames: number;
}

/** Defaults for every export option, so callers can spread over them. */
export const TRACK_EXPORT_DEFAULTS: TrackExportOptions = {
  format: 'csv',
  every: 0,
  precision: DEFAULT_PRECISION,
  pixels: false,
  relative: false,
  maxFrames: DEFAULT_MAX_FRAMES,
};

/** What the export wrote, printed as the `--json` document. */
export interface TrackExportManifest {
  format: TrackExportFormat;
  /** 'normalized' (0–1 fractions) or 'pixels' of the display frame. */
  units: 'normalized' | 'pixels';
  /** 'media' (absolute seconds) or 'track' (offset from the track's start). */
  timebase: 'media' | 'track';
  precision: number;
  every: number;
  maxFramesPerTrack?: number;
  trackCount: number;
  frameCount: number;
  /** Tracks that matched but stored no keyframes (speech/speaker). */
  tracksWithoutGeometry: number;
  /** Sum of `trackData.frameCount` before decimation, when providers wrote it. */
  storedFrameCount: number;
}

/**
 * Frames an export would write, estimated from the summary rows alone.
 *
 * This is what makes the budget cheap to enforce: `trackData.frameCount` is
 * already on every row the first phase reads, so an over-budget request is
 * refused before a single keyframe is fetched. Decimation is modelled from the
 * track's span rather than its frames, which is exact for the fixed provider
 * cadence and conservative otherwise.
 */
export function estimateExportFrames(
  tracks: readonly TrackRecord[],
  opts: Pick<TrackExportOptions, 'every' | 'maxFramesPerTrack'>
): number {
  let total = 0;
  for (const track of tracks) {
    const stored = trackFrameCount(track) ?? 0;
    if (stored === 0) continue;
    let frames = stored;
    if (opts.every > 0) {
      // One frame per step across the span, plus the retained final frame.
      frames = Math.min(frames, Math.floor(track.duration / opts.every) + 2);
    }
    if (opts.maxFramesPerTrack !== undefined) {
      frames = Math.min(frames, opts.maxFramesPerTrack);
    }
    total += frames;
  }
  return total;
}

/** Apply `--every`, `--max-frames-per-track`, `--relative` and `--precision`. */
export function prepareFrames(
  keyframes: readonly Keyframe[],
  track: Pick<LabelTrack, 'start'>,
  opts: TrackExportOptions
): Keyframe[] {
  let frames = decimateKeyframes(keyframes, opts.every);
  if (opts.maxFramesPerTrack !== undefined) {
    frames = sampleKeyframes(frames, opts.maxFramesPerTrack);
  }
  if (opts.relative) {
    frames = frames.map((kf) => ({ ...kf, t: kf.t - track.start }));
  }
  return frames.map((kf) => roundKeyframe(kf, opts.precision));
}

/** Column order for `--format csv`; geometry names carry their units. */
export function csvHeader(opts: Pick<TrackExportOptions, 'pixels'>): string {
  const geometry = opts.pixels
    ? ['left_px', 'top_px', 'right_px', 'bottom_px']
    : ['left', 'top', 'right', 'bottom'];
  return [
    'track',
    'trackId',
    'media',
    'type',
    'subject',
    'entity',
    't',
    ...geometry,
    'confidence',
  ].join(',');
}

/** Escape a CSV field: quote only when it would otherwise break the row. */
export function csvField(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** One flat row per keyframe, in whichever shape the caller asked for. */
export interface ExportRow {
  track: string;
  trackId: string;
  media: string;
  type: string;
  subject: string;
  entity: string;
  t: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  confidence: number | '';
}

/** Flatten one keyframe of one track into its export row. */
export function exportRow(
  track: TrackRecord,
  kf: Keyframe,
  opts: Pick<TrackExportOptions, 'pixels'>,
  frame: { width: number; height: number }
): ExportRow | null {
  const pixels = opts.pixels
    ? bboxToPixels(kf.bbox, frame.width, frame.height)
    : null;
  // A --pixels export of a media with no usable dimensions would emit zeros
  // that read as a real box in the top-left corner. Drop the row instead.
  if (opts.pixels && !pixels) return null;
  const box = pixels ?? kf.bbox;
  return {
    track: track.id,
    trackId: track.trackId,
    media: track.MediaRef,
    type: track.labelType || '',
    subject: trackSubject(track),
    entity: trackEntity(track)?.name ?? '',
    t: kf.t,
    left: box.left,
    top: box.top,
    right: box.right,
    bottom: box.bottom,
    confidence: typeof kf.confidence === 'number' ? kf.confidence : '',
  };
}

/** Render an export row as a CSV line. */
export function csvLine(row: ExportRow): string {
  return [
    row.track,
    row.trackId,
    row.media,
    row.type,
    row.subject,
    row.entity,
    row.t,
    row.left,
    row.top,
    row.right,
    row.bottom,
    row.confidence,
  ]
    .map(csvField)
    .join(',');
}

/**
 * Every track matching a scope, summary-projected and fully paged.
 *
 * Phase one of the export: cheap enough to run before deciding whether the
 * expensive phase is allowed to happen at all.
 */
export async function fetchExportTracks(
  pb: TypedPocketBase,
  filter: string,
  sort = 'MediaRef,start,id'
): Promise<TrackRecord[]> {
  const mutator = summaryTracks(pb);
  const items: TrackRecord[] = [];
  let page = 1;
  for (;;) {
    const result = (await mutator.getList(
      page,
      TRACK_PAGE_SIZE,
      filter,
      sort,
      TRACK_EXPANDS as never
    )) as ListResult<TrackRecord>;
    items.push(...result.items);
    if (page >= result.totalPages || result.items.length === 0) break;
    page++;
  }
  return items;
}

/** The error a caller gets when their export would blow the frame budget. */
export function budgetExceededMessage(
  estimated: number,
  opts: TrackExportOptions
): string {
  const narrowings = [
    '--every <seconds> (one frame per interval)',
    '--max-frames-per-track <n>',
    '-t <type> to a single track kind',
    '--from/--to to a time window',
    '--min-confidence / --min-duration to drop noise',
  ];
  return (
    `This export would write about ${estimated.toLocaleString()} keyframes, past ` +
    `the ${opts.maxFrames.toLocaleString()}-frame budget. Nothing was fetched. ` +
    `Narrow it with one of:\n  ${narrowings.join('\n  ')}\n` +
    'or raise the ceiling with --max-frames.'
  );
}

/** Media whose display dimensions a `--pixels` export needs, keyed by id. */
export async function frameSizes(
  pb: TypedPocketBase,
  tracks: readonly TrackRecord[]
): Promise<Map<string, { width: number; height: number }>> {
  const sizes = new Map<string, { width: number; height: number }>();
  const missing = new Set<string>();
  for (const track of tracks) {
    if (sizes.has(track.MediaRef)) continue;
    const media = track.expand?.MediaRef;
    if (media) {
      const { width, height } = mediaDisplayDimensions(media);
      sizes.set(track.MediaRef, { width, height });
    } else {
      missing.add(track.MediaRef);
    }
  }
  // The expand covers every normal path; this is the fallback for a track
  // whose media the projection could not carry.
  const mutator = new MediaMutator(pb, { expand: [] });
  for (const id of missing) {
    const media = await mutator.getById(id);
    const { width, height } = mediaDisplayDimensions(media ?? undefined);
    sizes.set(id, { width, height });
  }
  return sizes;
}
