import { existsSync, statSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import {
  FileMutator,
  FileType,
  MediaType,
  lastContentTileIndex,
  normalizeFilmstripSegments,
  segmentForTime,
  sourceTimeAtCompositeOffset,
  tileIndexFor,
  type File as PbFile,
  type FilmstripSegment,
  type TypedPocketBase,
} from '@project/shared';
import { clipEditListFilter } from './clip-edit-list.js';
import { downloadDerivedFile } from './files.js';
import {
  cropTile,
  decodeFilmstripJpeg,
  encodeJpeg,
  gridDividesExactly,
  FRAME_JPEG_QUALITY,
} from './frame-image.js';
import { requireMedia, type MediaWithUpload } from './select.js';
import { singleMediaType } from './timeline.js';

/**
 * `vw frame` — one still image, sourced entirely from the filmstrip sprite
 * sheets the transcode pipeline already produces.
 *
 * The whole command reads derived proxy material from the Files collection and
 * nothing else: no ffmpeg, no original upload, no worker task. That also caps
 * what it can deliver — filmstrips are sampled at 1 fps and tiles are ~320px
 * wide, so a frame is a preview, not a master.
 */

export type FrameSourceKind = 'media' | 'clip';

/**
 * The two mutually exclusive `--media`/`--clip` flags.
 *
 * Deliberately no `--timeline-clip`: a timeline clip is either a window onto
 * a media (reachable through `-m`/`-c` already) or a nested timeline, and a
 * frame of a nested timeline is a composite that only the renderer can make.
 */
export interface FrameSourceOptions {
  media?: string;
  clip?: string;
}

export interface ResolvedFrameSource {
  kind: FrameSourceKind;
  /** The id the flag named. */
  sourceId: string;
  media: MediaWithUpload;
  /**
   * What `--at` counts in: absolute media seconds for `--media`, seconds from
   * the clip's first played frame (cut gaps skipped) for `--clip`.
   */
  atDomain: 'media' | 'offset';
  /** The largest `--at` this source accepts. */
  maxAt: number;
  /** `--at` translated to absolute source-media seconds. */
  sourceTime: number;
}

/** Exactly one source flag, checked before any network call. */
export function assertSingleFrameSource(opts: FrameSourceOptions): void {
  const given = [opts.media, opts.clip].filter(Boolean);
  if (given.length === 0) {
    throw new Error('Pass --media <id> or --clip <mediaClipId>.');
  }
  if (given.length > 1) {
    throw new Error('--media and --clip are mutually exclusive.');
  }
}

/** Total played length of an edit list (gaps excluded). */
function playedDuration(
  segments: Array<{ start: number; end: number }>
): number {
  return segments.reduce((sum, s) => sum + Math.max(0, s.end - s.start), 0);
}

/**
 * Resolve a source flag plus `--at` into a media and an absolute source time.
 *
 * `--clip` goes through `clipEditListFilter`, which returns the windowed edit
 * list the clip actually plays — so `--at` maps through cut gaps the same way
 * the renderer and `vw timeline clips map` do.
 */
export async function resolveFrameSource(
  pb: TypedPocketBase,
  opts: FrameSourceOptions,
  at: number
): Promise<ResolvedFrameSource> {
  assertSingleFrameSource(opts);

  if (opts.media) {
    const media = await requireMedia(pb, opts.media);
    if (at > media.duration) {
      throw new Error(
        `--at ${at.toFixed(2)}s is past the end of media ${media.id} ` +
          `(duration ${media.duration.toFixed(2)}s).`
      );
    }
    return {
      kind: 'media',
      sourceId: media.id,
      media,
      atDomain: 'media',
      maxAt: media.duration,
      sourceTime: at,
    };
  }

  const sourceId = opts.clip as string;
  const editList = await clipEditListFilter(pb, { clip: sourceId });
  const maxAt = playedDuration(editList.segments);
  if (at > maxAt) {
    throw new Error(
      `--at ${at.toFixed(2)}s is past the end of clip ${sourceId} ` +
        `(it plays ${maxAt.toFixed(2)}s; --at is seconds from the clip's ` +
        `first played frame, not a source-media time).`
    );
  }

  return {
    kind: 'clip',
    sourceId,
    media: await requireMedia(pb, editList.mediaId),
    atDomain: 'offset',
    maxAt,
    sourceTime: sourceTimeAtCompositeOffset(editList.segments, at),
  };
}

/**
 * The media's filmstrip sheets, newest schema first.
 *
 * `MediaMutator` expands `filmstripFileRefs` by default, so the happy path
 * costs no extra request. The id query is the fallback for a Media whose
 * expand came back short (PocketBase caps multi-relation expands, reachable
 * past ~1000 segments) — ids are bound one clause at a time, never
 * interpolated.
 */
export async function loadFilmstripFiles(
  pb: TypedPocketBase,
  media: MediaWithUpload
): Promise<PbFile[]> {
  const refs = media.filmstripFileRefs ?? [];
  if (refs.length === 0) return [];

  const expanded = (media as { expand?: { filmstripFileRefs?: PbFile[] } })
    .expand?.filmstripFileRefs;
  if (expanded && expanded.length === refs.length) return expanded;

  const mutator = new FileMutator(pb);
  const files: PbFile[] = [];
  for (let i = 0; i < refs.length; i += 100) {
    const filter = refs
      .slice(i, i + 100)
      .map((id) => pb.filter('id = {:id}', { id }))
      .join(' || ');
    files.push(...(await mutator.getFullList(filter, 'created')));
  }
  return files;
}

export interface SelectedTile {
  segment: FilmstripSegment;
  index: number;
  col: number;
  row: number;
  /** Nominal capture time of this tile: startTime + index / fps. */
  frameTime: number;
  /** True when the tile is not the one the requested time asked for. */
  clamped: boolean;
}

/**
 * Which tile holds the frame for `sourceTime`. Pure.
 *
 * Two clamps, both deliberate. A time outside every segment falls back to the
 * nearest one rather than erroring: segment coverage is frozen at transcode
 * time, so a media re-probed a hair longer would otherwise fail at its own
 * final second. And the tile index is capped at the last cell holding real
 * picture — ffmpeg's `tile` filter pads a short final sheet out to a full grid
 * with black, so the naive `cols * rows - 1` clamp hands back a black square.
 */
export function selectFrameTile(
  segments: FilmstripSegment[],
  mediaDuration: number,
  sourceTime: number
): SelectedTile {
  if (segments.length === 0) {
    throw new Error('No filmstrip segments to choose from.');
  }

  const exact = segmentForTime(segments, sourceTime);
  const segment =
    exact ??
    (sourceTime < segments[0].config.startTime
      ? segments[0]
      : segments[segments.length - 1]);

  const wanted = tileIndexFor(segment.config, sourceTime);
  const index = Math.min(
    wanted,
    lastContentTileIndex(segment.config, mediaDuration)
  );

  return {
    segment,
    index,
    col: index % segment.config.cols,
    row: Math.floor(index / segment.config.cols),
    frameTime: segment.config.startTime + index / segment.config.fps,
    clamped: !exact || index !== wanted,
  };
}

/** Default output name — deterministic across media and times. */
export function defaultFrameFilename(
  mediaId: string,
  sourceTime: number
): string {
  return `frame-${mediaId}-${sourceTime.toFixed(2)}s.jpg`;
}

/**
 * Where the JPEG lands. `--out` is a file path unless it names an existing
 * directory or ends with a separator, in which case the default name is used
 * inside it. `isDirectory` is injected so this stays pure and testable.
 */
export function resolveFramePath(
  out: string | undefined,
  defaultName: string,
  cwd: string,
  isDirectory: (path: string) => boolean
): string {
  if (!out) return join(cwd, defaultName);
  const absolute = isAbsolute(out) ? out : resolve(cwd, out);
  if (out.endsWith(sep) || out.endsWith('/') || isDirectory(absolute)) {
    return join(absolute, defaultName);
  }
  return absolute;
}

/** Whether a path exists and is a directory (the real `isDirectory`). */
export function isExistingDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export interface ExtractFrameOptions extends FrameSourceOptions {
  /** Seconds, in this source's `--at` domain. */
  at: number;
  /** Output file or directory; ignored when `base64` is set. */
  out?: string;
  /** Return the JPEG as base64 instead of writing a file. */
  base64?: boolean;
  /** Overwrite an existing output file. */
  force?: boolean;
}

export interface FrameResult {
  source: { kind: FrameSourceKind; id: string };
  mediaId: string;
  at: { domain: 'media' | 'offset'; value: number };
  /** Absolute source-media seconds the request resolved to. */
  sourceTime: number;
  /** Nominal capture time of the tile returned (filmstrips sample 1 fps). */
  frameTime: number;
  clamped: boolean;
  segment: {
    fileId: string;
    segmentIndex: number;
    startTime: number;
    cols: number;
    rows: number;
    fps: number;
  };
  tile: { index: number; col: number; row: number };
  image: {
    width: number;
    height: number;
    format: 'jpeg';
    quality: number;
    bytes: number;
    /** Always 'decoded' — stored tile sizes are not trusted. See tileRect. */
    geometrySource: 'decoded';
  };
  path: string | null;
  base64: string | null;
  /** Non-fatal notes for the caller to surface on stderr. */
  warnings: string[];
}

/** Everything: resolve the source, fetch the sheet, cut the tile, emit it. */
export async function extractFrame(
  pb: TypedPocketBase,
  opts: ExtractFrameOptions
): Promise<FrameResult> {
  if (opts.base64 && (opts.out || opts.force)) {
    throw new Error(
      '--base64 prints the frame instead of writing a file — drop -o/--force.'
    );
  }

  const source = await resolveFrameSource(pb, opts, opts.at);
  const { media } = source;
  const mediaType = singleMediaType(media.mediaType);
  if (mediaType !== String(MediaType.VIDEO)) {
    throw new Error(
      `Media ${media.id} is ${mediaType} — only video media has filmstrip frames.`
    );
  }

  const files = await loadFilmstripFiles(pb, media);
  const segments = normalizeFilmstripSegments(files);
  if (segments.length === 0) {
    const detail =
      files.length > 0
        ? ` (its ${files.length} filmstrip file(s) carry no usable ` +
          'filmstripConfig — regenerate them)'
        : '';
    throw new Error(
      `Media ${media.id} has no filmstrip${detail}. Generate one with ` +
        `\`vw job transcode -m ${media.id} -a filmstrip\`, then re-run ` +
        '(a running worker must pick the task up).'
    );
  }

  const warnings: string[] = [];
  const tile = selectFrameTile(segments, media.duration, source.sourceTime);
  const file = files.find((f) => f.id === tile.segment.fileId);
  if (!file) {
    throw new Error(`Filmstrip file ${tile.segment.fileId} disappeared.`);
  }
  if (String(file.fileType) !== String(FileType.FILMSTRIP)) {
    throw new Error(
      `File ${file.id} is referenced as a filmstrip but is fileType ` +
        `"${String(file.fileType)}".`
    );
  }

  const subject =
    `filmstrip segment ${tile.segment.config.segmentIndex} of media ${media.id}` +
    ` (File ${file.id})`;
  const bytes = await downloadDerivedFile(pb, file, subject);
  const sheet = decodeFilmstripJpeg(bytes, subject);

  const grid = {
    cols: tile.segment.config.cols,
    rows: tile.segment.config.rows,
  };
  if (!gridDividesExactly(sheet, grid)) {
    warnings.push(
      `Filmstrip sheet ${file.id} is ${sheet.width}x${sheet.height}, not a ` +
        `whole multiple of ${grid.cols}x${grid.rows} — cropping to the ` +
        'largest whole tile.'
    );
  }
  const cropped = cropTile(sheet, grid, tile.index);
  const jpeg = encodeJpeg(cropped);

  if (tile.clamped) {
    warnings.push(
      `No filmstrip tile covers ${source.sourceTime.toFixed(2)}s exactly — ` +
        `returned the nearest frame at ${tile.frameTime.toFixed(2)}s.`
    );
  }
  if (Math.abs(tile.frameTime - source.sourceTime) > 0.001) {
    warnings.push(
      `Filmstrips sample 1 fps — this is the frame captured at ` +
        `${tile.frameTime.toFixed(2)}s, covering ` +
        `${tile.frameTime.toFixed(2)}–${(tile.frameTime + 1 / tile.segment.config.fps).toFixed(2)}s.`
    );
  }

  let path: string | null = null;
  if (!opts.base64) {
    path = resolveFramePath(
      opts.out,
      defaultFrameFilename(media.id, source.sourceTime),
      process.cwd(),
      isExistingDirectory
    );
    const dir = dirname(path);
    if (!isExistingDirectory(dir)) {
      throw new Error(`Output directory does not exist: ${dir}`);
    }
    if (existsSync(path) && !opts.force) {
      throw new Error(`Refusing to overwrite ${path} — pass --force.`);
    }
    await writeFile(path, jpeg);
  }

  return {
    source: { kind: source.kind, id: source.sourceId },
    mediaId: media.id,
    at: { domain: source.atDomain, value: opts.at },
    sourceTime: source.sourceTime,
    frameTime: tile.frameTime,
    clamped: tile.clamped,
    segment: {
      fileId: file.id,
      segmentIndex: tile.segment.config.segmentIndex,
      startTime: tile.segment.config.startTime,
      cols: grid.cols,
      rows: grid.rows,
      fps: tile.segment.config.fps,
    },
    tile: { index: tile.index, col: tile.col, row: tile.row },
    image: {
      width: cropped.width,
      height: cropped.height,
      format: 'jpeg',
      quality: FRAME_JPEG_QUALITY,
      bytes: jpeg.length,
      geometrySource: 'decoded',
    },
    path,
    base64: opts.base64 ? jpeg.toString('base64') : null,
    warnings,
  };
}

/** Human-readable summary lines for a frame result (stdout). */
export function frameSummaryLines(result: FrameResult): string[] {
  const lines: string[] = [];
  const where = result.path ?? `${result.image.bytes} bytes of base64`;
  lines.push(`Frame at ${result.sourceTime.toFixed(2)}s → ${where}`);

  const detail =
    `  media ${result.mediaId} · captured ${result.frameTime.toFixed(2)}s · ` +
    `segment ${result.segment.segmentIndex} tile ${result.tile.index} · ` +
    `${result.image.width}x${result.image.height} jpeg q${result.image.quality} · ` +
    `${(result.image.bytes / 1024).toFixed(1)} KB`;
  lines.push(detail);

  if (result.at.domain === 'offset') {
    lines.push(
      `  clip ${result.source.id} offset ${result.at.value.toFixed(2)}s → ` +
        `media ${result.sourceTime.toFixed(2)}s`
    );
  }
  return lines;
}
