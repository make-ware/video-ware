import type { FilmstripConfig } from '../types/task-contracts.js';

/**
 * Filmstrip geometry: mapping a media time to a tile in a sprite sheet.
 *
 * The transcode pipeline emits one JPEG per 100 seconds of video, each a
 * `cols x rows` grid of tiles sampled at `fps` (today: 100x1 at 1 fps, so one
 * tile per second). Every consumer — the webapp's FilmstripViewer, the label
 * crop thumbnails, the CLI's `vw frame` — needs the same three answers: which
 * segment covers this time, which tile inside it, and what timestamp that tile
 * actually captured. They live here so the arithmetic has one home.
 *
 * Everything in this module is pure arithmetic, so it stays browser-safe.
 */

/** The subset of FilmstripConfig needed to locate a tile. */
export interface TileGeometry {
  cols: number;
  rows: number;
  fps: number;
  startTime: number;
}

/** One filmstrip sprite sheet with a complete, defaulted geometry. */
export interface FilmstripSegment {
  /** The Files record id this sprite sheet lives on. */
  fileId: string;
  config: TileGeometry & { segmentIndex: number };
}

/** Filmstrips have always been sampled at 1 frame per second. */
export const DEFAULT_FILMSTRIP_FPS = 1;

/** A File record as far as filmstrip normalization cares. */
export interface FilmstripFileLike {
  id: string;
  meta?: { filmstripConfig?: FilmstripConfig } | null;
}

/** Seconds of media one segment covers: every tile, at `fps` per second. */
export function segmentDuration(config: {
  cols: number;
  rows: number;
  fps: number;
}): number {
  return (config.cols * config.rows) / config.fps;
}

/**
 * Normalize raw filmstrip File records into segments with a complete config.
 *
 * Segments are ordered by `segmentIndex` when present, otherwise by their
 * incoming order (creation order, which matches segment order since the worker
 * emits segments sequentially). Missing `fps`/`startTime`/`segmentIndex` are
 * derived so that records written before those fields existed still resolve.
 * Records without `cols`/`rows` carry no usable geometry and are dropped.
 */
export function normalizeFilmstripSegments(
  files: FilmstripFileLike[]
): FilmstripSegment[] {
  const ordered = [...files].sort((a, b) => {
    const idxA = a.meta?.filmstripConfig?.segmentIndex ?? 0;
    const idxB = b.meta?.filmstripConfig?.segmentIndex ?? 0;
    return idxA - idxB;
  });

  return ordered.flatMap((file, index) => {
    const raw = file.meta?.filmstripConfig;
    if (!raw?.cols || !raw?.rows) return [];

    const fps = raw.fps ?? DEFAULT_FILMSTRIP_FPS;
    const segmentIndex = raw.segmentIndex ?? index;
    const startTime =
      raw.startTime ??
      segmentIndex * segmentDuration({ cols: raw.cols, rows: raw.rows, fps });

    return [
      {
        fileId: file.id,
        config: {
          cols: raw.cols,
          rows: raw.rows,
          fps,
          startTime,
          segmentIndex,
        },
      },
    ];
  });
}

/**
 * The segment covering `time`, or null when no segment does. The list is small
 * (one per 100s of media, so ~100 for 3 hours), so a linear scan is fine.
 */
export function segmentForTime(
  segments: FilmstripSegment[],
  time: number
): FilmstripSegment | null {
  return (
    segments.find(
      ({ config }) =>
        time >= config.startTime &&
        time < config.startTime + segmentDuration(config)
    ) ?? null
  );
}

/** The span of media time the given segments cover, or null when empty. */
export function segmentsCoverage(
  segments: FilmstripSegment[]
): { start: number; end: number } | null {
  if (segments.length === 0) return null;
  const starts = segments.map((s) => s.config.startTime);
  const ends = segments.map(
    (s) => s.config.startTime + segmentDuration(s.config)
  );
  return { start: Math.min(...starts), end: Math.max(...ends) };
}

/** Index of the sprite tile the viewer would show for `time`. */
export function tileIndexFor(config: TileGeometry, time: number): number {
  const local = Math.max(0, time - config.startTime);
  const total = config.cols * config.rows;
  return Math.min(Math.max(Math.floor(local * config.fps), 0), total - 1);
}

/**
 * Highest tile index in a segment that holds real picture.
 *
 * ffmpeg's `tile` filter emits a full `cols x rows` grid even when the source
 * runs out of frames first — the leftover cells are padded black. A media's
 * last segment is almost always short (a 212s media makes three 100-tile
 * sheets, the third holding 12 real frames), so clamping only to
 * `cols * rows - 1` hands back a black tile. Clamp to this instead.
 */
export function lastContentTileIndex(
  config: TileGeometry,
  mediaDuration: number
): number {
  const covered = mediaDuration - config.startTime;
  const frames = Math.ceil(covered * config.fps);
  const total = config.cols * config.rows;
  return Math.min(Math.max(frames - 1, 0), total - 1);
}

/**
 * Media timestamp of the frame actually captured in the tile shown for `time`.
 * Sampling is 1 fps, so a request for 12.9s resolves to the frame at 12.0s.
 */
export function tileFrameTime(config: TileGeometry, time: number): number {
  return config.startTime + tileIndexFor(config, time) / config.fps;
}

/**
 * Pixel rect of one tile, derived from the sprite's REAL decoded dimensions.
 *
 * Deliberately ignores `meta.filmstripConfig.tileWidth/tileHeight`. The worker
 * now records the geometry it actually generated, but every strip written
 * before that stored the tile size it was *asked* for while the executor
 * silently derived a different height from the source aspect — so those
 * records are wrong for anything but 16:9, and they are still in the database.
 * A caller holding the decoded image never has to care which era a record came
 * from: `cols`/`rows` divide the sheet exactly (ffmpeg's `tile` filter emits a
 * flush grid), so the pixels answer the question outright.
 */
export function tileRect(
  config: { cols: number; rows: number },
  image: { width: number; height: number },
  tileIndex: number
): { x: number; y: number; width: number; height: number } {
  if (!config.cols || !config.rows) {
    throw new Error(
      `Filmstrip has no tile grid (cols=${config.cols}, rows=${config.rows}).`
    );
  }
  const width = Math.floor(image.width / config.cols);
  const height = Math.floor(image.height / config.rows);
  if (width < 1 || height < 1) {
    throw new Error(
      `Filmstrip is ${image.width}x${image.height}, too small for a ` +
        `${config.cols}x${config.rows} tile grid.`
    );
  }
  const total = config.cols * config.rows;
  const index = Math.min(Math.max(tileIndex, 0), total - 1);
  return {
    x: (index % config.cols) * width,
    y: Math.floor(index / config.cols) * height,
    width,
    height,
  };
}
