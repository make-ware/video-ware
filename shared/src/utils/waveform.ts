import type { WaveformConfig } from '../types/task-contracts.js';

/**
 * Waveform geometry: splitting a media's audio into fixed-scale chunk images.
 *
 * The transcode pipeline renders the audio track with ffmpeg's `showwavespic`,
 * one PNG per chunk. Chunking is not cosmetic: a single image squashes millions
 * of samples into each pixel (and ffmpeg cannot render past ~32k px anyway), so
 * a two-hour podcast drawn whole is a solid block. Chunks are cut at a fixed
 * horizontal scale — `pixelsPerSecond` px per second of audio — so every image
 * in a media shares one time-to-pixel mapping and consumers can lay them end to
 * end.
 *
 * Everything in this module is pure arithmetic, so it stays browser-safe.
 */

/** One pixel per second keeps an hours-long file readable. */
export const DEFAULT_WAVEFORM_PIXELS_PER_SECOND = 1;

/** Pixel width of a full chunk when a request doesn't say. */
export const DEFAULT_WAVEFORM_WIDTH = 1000;

/** Pixel height of a chunk when a request doesn't say. */
export const DEFAULT_WAVEFORM_HEIGHT = 200;

/**
 * A trailing chunk shorter than this is absorbed into its predecessor instead
 * of becoming its own sliver image. Keeping the scale exact everywhere is what
 * matters; one slightly-wider final image costs nothing, a 1px PNG is useless.
 */
const MIN_TAIL_SECONDS = 1;

/** One waveform image to render: where it starts, and how wide it is. */
export interface WaveformChunk {
  /** 0-based position of this chunk within the media */
  index: number;
  /** Absolute media time (seconds) of this chunk's first pixel */
  startTime: number;
  /** Seconds of audio this chunk covers */
  duration: number;
  /** Pixel width, always `round(duration * pixelsPerSecond)` (min 1) */
  width: number;
}

/** The horizontal scale a config asks for, defaulted and sanity-checked. */
function resolvePixelsPerSecond(
  config: Pick<WaveformConfig, 'pixelsPerSecond'>
) {
  const requested = config.pixelsPerSecond;
  return requested && requested > 0
    ? requested
    : DEFAULT_WAVEFORM_PIXELS_PER_SECOND;
}

/**
 * Split `duration` seconds of audio into the chunks to render.
 *
 * Each full chunk covers `width / pixelsPerSecond` seconds; the final one
 * covers whatever is left and is narrower to match, so the scale is identical
 * in every image. A leftover under MIN_TAIL_SECONDS is folded into the previous
 * chunk (making it slightly wider) rather than emitted on its own.
 *
 * Returns an empty list for a media with no measurable duration — there is
 * nothing to draw, and ffmpeg would emit a zero-width image.
 */
export function planWaveformChunks(
  duration: number,
  config: WaveformConfig
): WaveformChunk[] {
  if (!Number.isFinite(duration) || duration <= 0) return [];

  const pixelsPerSecond = resolvePixelsPerSecond(config);
  const width =
    config.width && config.width > 0 ? config.width : DEFAULT_WAVEFORM_WIDTH;
  const chunkSeconds = width / pixelsPerSecond;

  let count = Math.max(1, Math.ceil(duration / chunkSeconds));
  if (count > 1 && duration - (count - 1) * chunkSeconds < MIN_TAIL_SECONDS) {
    count -= 1;
  }

  return Array.from({ length: count }, (_unused, index) => {
    const startTime = index * chunkSeconds;
    const chunkDuration =
      index === count - 1 ? duration - startTime : chunkSeconds;
    return {
      index,
      startTime,
      duration: chunkDuration,
      width: Math.max(1, Math.round(chunkDuration * pixelsPerSecond)),
    };
  });
}

/** A File record as far as waveform normalization cares. */
export interface WaveformFileLike {
  id: string;
  meta?: { waveformConfig?: WaveformConfig } | null;
}

/** One rendered chunk, resolved back to a complete geometry. */
export interface WaveformSegment {
  /** The Files record id this image lives on. */
  fileId: string;
  config: Required<
    Pick<WaveformConfig, 'width' | 'height' | 'chunkIndex' | 'startTime'>
  > & {
    duration: number;
    pixelsPerSecond: number;
  };
}

/**
 * Normalize raw waveform File records into ordered segments.
 *
 * Ordered by `chunkIndex` when present, otherwise by incoming order (creation
 * order, which matches chunk order since the worker renders sequentially).
 * A record without a usable `width` carries no geometry and is dropped;
 * `duration` falls back to the width at the recorded scale, and `startTime`
 * to the sum of the durations before it.
 */
export function normalizeWaveformSegments(
  files: WaveformFileLike[]
): WaveformSegment[] {
  const ordered = [...files].sort(
    (a, b) =>
      (a.meta?.waveformConfig?.chunkIndex ?? 0) -
      (b.meta?.waveformConfig?.chunkIndex ?? 0)
  );

  let elapsed = 0;
  return ordered.flatMap((file, index) => {
    const raw = file.meta?.waveformConfig;
    if (!raw?.width) return [];

    const pixelsPerSecond = resolvePixelsPerSecond(raw);
    const duration = raw.duration ?? raw.width / pixelsPerSecond;
    const startTime = raw.startTime ?? elapsed;
    elapsed = startTime + duration;

    return [
      {
        fileId: file.id,
        config: {
          width: raw.width,
          height: raw.height ?? DEFAULT_WAVEFORM_HEIGHT,
          chunkIndex: raw.chunkIndex ?? index,
          startTime,
          duration,
          pixelsPerSecond,
        },
      },
    ];
  });
}

/**
 * The segment covering `time`, or null when none does. The list is small (one
 * per ~1000s of media at the default scale), so a linear scan is fine.
 */
export function waveformSegmentForTime(
  segments: WaveformSegment[],
  time: number
): WaveformSegment | null {
  return (
    segments.find(
      ({ config }) =>
        time >= config.startTime && time < config.startTime + config.duration
    ) ?? null
  );
}
