/**
 * Display geometry of a media item — the frame size a viewer actually sees.
 *
 * `Media.width/height` (and `ProbeOutput.width/height`) are the CODED
 * dimensions. A phone video shot in portrait is commonly stored as 1920x1080
 * with a 90° display matrix, and both ffmpeg (autorotate, on by default) and
 * every browser rotate on decode — so the frames that reach a `scale` filter,
 * a `<video>` element, or a sprite tile are 1080x1920. Deriving tile or box
 * geometry from the coded pair squashes those clips.
 *
 * Every consumer that needs "how wide/tall is a frame" must go through here so
 * the worker's generated assets and the webapp's layout agree.
 */

/** Anything carrying coded dimensions plus enough info to un-rotate them. */
export interface DisplayDimensionsSource {
  width?: number | null;
  height?: number | null;
  rotation?: number | null;
  /** `Media.mediaData` / a raw ProbeOutput — the most authoritative source. */
  mediaData?: {
    width?: number | null;
    height?: number | null;
    displayWidth?: number | null;
    displayHeight?: number | null;
    rotation?: number | null;
    video?: { rotation?: number | null } | null;
  } | null;
}

export interface DisplayDimensions {
  width: number;
  height: number;
  /** width / height, or 0 when the dimensions are unknown. */
  aspect: number;
}

/** Rotation in degrees normalized to [0, 360), or 0 when absent/garbage. */
export function normalizeRotation(rotation?: number | null): number {
  if (typeof rotation !== 'number' || !isFinite(rotation)) return 0;
  return ((Math.round(rotation) % 360) + 360) % 360;
}

/** True when the rotation swaps the frame's width and height. */
export function rotationSwapsAxes(rotation?: number | null): boolean {
  const normalized = normalizeRotation(rotation);
  return normalized === 90 || normalized === 270;
}

function positive(value?: number | null): number {
  return typeof value === 'number' && isFinite(value) && value > 0 ? value : 0;
}

/**
 * Display width/height/aspect for a media item.
 *
 * Resolution order: the probe's own `displayWidth/displayHeight` (written by
 * the PROBE step and already rotation-adjusted), then the coded pair swapped
 * by rotation, then the coded pair as-is. Returns zeros for audio-only media
 * (no video stream, so no frame), which callers should treat as "unknown"
 * rather than substituting a default silently.
 */
export function mediaDisplayDimensions(
  source: DisplayDimensionsSource | null | undefined
): DisplayDimensions {
  const probe = source?.mediaData ?? undefined;

  const probedWidth = positive(probe?.displayWidth);
  const probedHeight = positive(probe?.displayHeight);
  if (probedWidth && probedHeight) {
    return {
      width: probedWidth,
      height: probedHeight,
      aspect: probedWidth / probedHeight,
    };
  }

  const codedWidth = positive(source?.width) || positive(probe?.width);
  const codedHeight = positive(source?.height) || positive(probe?.height);
  if (!codedWidth || !codedHeight) return { width: 0, height: 0, aspect: 0 };

  // Rotation may live on the Media row, on the probe output, or only on its
  // video stream block, depending on when the record was written.
  const rotation =
    source?.rotation ?? probe?.rotation ?? probe?.video?.rotation ?? 0;

  const width = rotationSwapsAxes(rotation) ? codedHeight : codedWidth;
  const height = rotationSwapsAxes(rotation) ? codedWidth : codedHeight;
  return { width, height, aspect: width / height };
}

/**
 * Display aspect ratio for a media item, falling back to `fallback` (16:9 by
 * default) when the dimensions are unknown.
 */
export function mediaDisplayAspect(
  source: DisplayDimensionsSource | null | undefined,
  fallback = 16 / 9
): number {
  const { aspect } = mediaDisplayDimensions(source);
  return aspect > 0 ? aspect : fallback;
}

/**
 * Tile height that keeps `tileWidth` at the source's display aspect, rounded
 * to an even number (ffmpeg's `scale` rejects odd dimensions for many pixel
 * formats, and the generated sheets are yuv420p JPEGs).
 *
 * This is THE definition of a sprite/filmstrip tile's shape: the generator
 * scales to exactly these dimensions, so whatever this returns is what ends up
 * in the pixels and therefore what must be recorded in the File's meta.
 */
export function evenTileHeight(tileWidth: number, aspect: number): number {
  if (!(tileWidth > 0) || !(aspect > 0) || !isFinite(aspect)) return 0;
  const height = Math.round(tileWidth / aspect);
  return Math.max(2, Math.round(height / 2) * 2);
}
