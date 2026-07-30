import type { FileMetadata, ProbeOutput } from '@project/shared';

/** The measured half of a File's `meta` — everything but the mime type. */
export type AssetFacts = Omit<FileMetadata, 'mimeType'>;

/**
 * Measured facts for a generated media asset's File `meta`, taken from a probe
 * of the finished output.
 *
 * Every producer of a time-based asset (proxy, extracted audio, render) probes
 * what it wrote rather than copying the request or the source's numbers: the
 * encoder decides the real frame size, frame rate and duration, and a proxy of
 * a rotated or non-16:9 source routinely differs from what was asked for.
 *
 * Fields ffprobe omits (bitrate/size for some containers, everything video for
 * an audio-only output) are left off instead of being zero-filled, so a reader
 * can tell "not reported" from "zero".
 */
export function probeFacts(probe: ProbeOutput): AssetFacts {
  const facts: AssetFacts = {};

  if (probe.duration > 0) facts.duration = probe.duration;
  if (probe.codec && probe.codec !== 'unknown') facts.codec = probe.codec;
  if (probe.format && probe.format !== 'unknown') facts.format = probe.format;
  if (typeof probe.bitrate === 'number') facts.bitrate = probe.bitrate;
  if (typeof probe.size === 'number') facts.size = probe.size;

  // Display dimensions: what a player shows after applying rotation. An
  // audio-only output reports 0x0 and gets no dimensions at all.
  const width = probe.displayWidth || probe.width;
  const height = probe.displayHeight || probe.height;
  if (width > 0 && height > 0) {
    facts.width = width;
    facts.height = height;
  }
  if (probe.fps > 0) facts.fps = probe.fps;

  if (probe.audio) {
    if (probe.audio.channels > 0) facts.channels = probe.audio.channels;
    const sampleRate = Number(probe.audio.sampleRate);
    if (isFinite(sampleRate) && sampleRate > 0) facts.sampleRate = sampleRate;
  }

  return facts;
}
