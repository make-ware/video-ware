/**
 * Ingest spec — the canonical description of what a full ingest produces.
 *
 * Every producer of derived assets (the worker's ingest orchestrator, the
 * webapp's "regenerate previews", the CLI's `vw job transcode`, and the weekly
 * ingest backfill) builds its `process_upload` payload from here, so all four
 * request the SAME geometry. Before this module those defaults were copied into
 * each caller and had already drifted (thumbnails at 320x180 vs 640x360, 5x5 vs
 * 10x10 sprite grids, no waveform at all in the CLI) — drift that the backfill
 * cannot tolerate, since it decides "is this asset current?" by comparing what
 * exists against what a fresh ingest would produce.
 *
 * ## Versioning
 *
 * Each asset-producing step carries a version in `INGEST_STEP_VERSIONS`. The
 * step's processor stamps that number onto the File it writes
 * (`File.meta.ingestVersion`), and the backfill regenerates any asset whose
 * stamp is older than the current version. So changing what a step emits —
 * a new proxy codec/resolution, a denser filmstrip, a different waveform scale
 * — is a two-line change here: edit the spec, bump its version, and the weekly
 * backfill rolls the whole library forward.
 *
 * Files written before versioning existed carry no stamp and read as
 * `INGEST_BASELINE_VERSION` (1) rather than 0, so introducing this module does
 * not re-encode every asset in the library — only a deliberate bump does.
 */

import { MediaType } from '../../enums.js';
import type { TranscodeFlowConfig } from '../flow-definitions.js';
import type { FileMetadata } from '../../types/metadata.js';
import { TranscodeStepType } from './types.js';

/**
 * The transcode steps that produce a stored File. PROBE and FINALIZE are
 * excluded on purpose: PROBE writes columns on Media (and is always part of the
 * flow regardless of what else was requested), FINALIZE produces nothing.
 */
export const INGEST_ASSET_STEPS = [
  TranscodeStepType.THUMBNAIL,
  TranscodeStepType.SPRITE,
  TranscodeStepType.FILMSTRIP,
  TranscodeStepType.WAVEFORM,
  TranscodeStepType.TRANSCODE,
  TranscodeStepType.AUDIO,
] as const;

/** A transcode step that produces a stored, backfillable asset. */
export type IngestAssetStep = (typeof INGEST_ASSET_STEPS)[number];

/**
 * The version an unstamped File is treated as. Assets produced before
 * `File.meta.ingestVersion` existed are the baseline generation, NOT version 0
 * — otherwise the first backfill run after this module shipped would have
 * re-encoded every proxy, sprite and filmstrip in the library.
 */
export const INGEST_BASELINE_VERSION = 1;

/**
 * Current spec version per asset step. Bump one when the corresponding entry in
 * `buildIngestTranscodeConfig` changes in a way that makes already-stored
 * assets stale (different geometry, codec, scale, tiling, …). Do NOT bump for
 * changes that leave the output identical.
 *
 * `Record<IngestAssetStep, number>` is exhaustive, so a new asset step fails to
 * compile until it declares a version.
 */
export const INGEST_STEP_VERSIONS: Record<IngestAssetStep, number> = {
  [TranscodeStepType.THUMBNAIL]: 1,
  [TranscodeStepType.SPRITE]: 1,
  [TranscodeStepType.FILMSTRIP]: 1,
  [TranscodeStepType.WAVEFORM]: 1,
  [TranscodeStepType.TRANSCODE]: 1,
  [TranscodeStepType.AUDIO]: 1,
};

/**
 * `File.meta` for an asset produced by `step`, merged into whatever else the
 * step records. Every asset-producing processor writes this so the backfill can
 * tell a current asset from a stale one.
 */
export function ingestMeta(
  step: IngestAssetStep
): Pick<FileMetadata, 'ingestVersion'> {
  return { ingestVersion: INGEST_STEP_VERSIONS[step] };
}

/**
 * Steps whose output is drawn from an audio stream. Skipped for media with no
 * audio: the processors self-skip (producing no File), so requesting them for a
 * silent file would make the backfill ask for the same missing asset forever.
 */
const AUDIO_DEPENDENT_STEPS: readonly IngestAssetStep[] = [
  TranscodeStepType.WAVEFORM,
  TranscodeStepType.AUDIO,
];

/**
 * The full transcode config a fresh ingest requests for `mediaType` — the
 * single source of truth for ingest geometry.
 *
 * Media-type gating: images have no timeline, so they get a 1x1 sprite and a
 * thumbnail but no filmstrip, waveform or proxy; audio files have no frames, so
 * they get only the extracted audio track and its waveform.
 */
export function buildIngestTranscodeConfig(
  mediaType: MediaType
): TranscodeFlowConfig {
  const isAudio = mediaType === MediaType.AUDIO;
  const isImage = mediaType === MediaType.IMAGE;

  return {
    sprite: isAudio
      ? undefined
      : isImage
        ? {
            fps: 1,
            cols: 1,
            rows: 1,
            tileWidth: 320,
            tileHeight: 180,
          }
        : {
            fps: 1,
            cols: 10,
            rows: 10,
            tileWidth: 320,
            tileHeight: 180,
          },
    thumbnail: isAudio
      ? undefined
      : {
          timestamp: 'midpoint',
          width: 640,
          height: 360,
        },
    filmstrip:
      isAudio || isImage
        ? undefined
        : {
            cols: 100,
            rows: 1,
            tileWidth: 320,
            tileHeight: 180,
          },
    // Waveforms are audio, so images are the only media without one.
    // 1000px at 1px/s: one image per ~16.6 minutes, the scale at which a
    // long file stays readable instead of collapsing into a solid bar.
    waveform: isImage
      ? undefined
      : {
          width: 1000,
          height: 200,
          pixelsPerSecond: 1,
          color: 'white',
          mono: true,
        },
    transcode: {
      enabled: !isAudio && !isImage,
      // Proxy is the web-playable preview; H.264 has universal browser
      // support, whereas H.265/HEVC fails to decode in most browsers
      // (NotSupportedError on play()).
      codec: 'h264',
      resolution: '720p',
    },
    audio: {
      enabled: !isImage,
      bitrate: '128k',
    },
  };
}

/**
 * The asset steps a fresh ingest of `mediaType` would run, derived from the
 * config itself so the two can never disagree.
 */
export function ingestStepsFor(mediaType: MediaType): IngestAssetStep[] {
  const config = buildIngestTranscodeConfig(mediaType);
  return INGEST_ASSET_STEPS.filter((step) => isStepRequested(config, step));
}

/** Whether `config` actually asks for `step` (respecting the `enabled` flags). */
function isStepRequested(
  config: TranscodeFlowConfig,
  step: IngestAssetStep
): boolean {
  switch (step) {
    case TranscodeStepType.THUMBNAIL:
      return !!config.thumbnail;
    case TranscodeStepType.SPRITE:
      return !!config.sprite;
    case TranscodeStepType.FILMSTRIP:
      return !!config.filmstrip;
    case TranscodeStepType.WAVEFORM:
      return !!config.waveform;
    case TranscodeStepType.TRANSCODE:
      return !!config.transcode?.enabled;
    case TranscodeStepType.AUDIO:
      return !!config.audio?.enabled;
  }
}

/**
 * A transcode config containing only `steps`, drawn from the ingest spec — what
 * the backfill (and any targeted regenerate) sends so an already-current asset
 * is never re-encoded. Steps not applicable to the media type are dropped.
 */
export function pickIngestTranscodeConfig(
  mediaType: MediaType,
  steps: readonly IngestAssetStep[]
): TranscodeFlowConfig {
  const full = buildIngestTranscodeConfig(mediaType);
  const wanted = new Set(steps);
  const picked: TranscodeFlowConfig = {};

  if (wanted.has(TranscodeStepType.THUMBNAIL) && full.thumbnail) {
    picked.thumbnail = full.thumbnail;
  }
  if (wanted.has(TranscodeStepType.SPRITE) && full.sprite) {
    picked.sprite = full.sprite;
  }
  if (wanted.has(TranscodeStepType.FILMSTRIP) && full.filmstrip) {
    picked.filmstrip = full.filmstrip;
  }
  if (wanted.has(TranscodeStepType.WAVEFORM) && full.waveform) {
    picked.waveform = full.waveform;
  }
  if (wanted.has(TranscodeStepType.TRANSCODE) && full.transcode?.enabled) {
    picked.transcode = full.transcode;
  }
  if (wanted.has(TranscodeStepType.AUDIO) && full.audio?.enabled) {
    picked.audio = full.audio;
  }

  return picked;
}

/** What the backfill knows about a media when deciding what it still needs. */
export interface IngestMediaFacts {
  mediaType: MediaType;
  /**
   * `Media.hasAudio`, as written by PROBE. `undefined` (never probed) counts as
   * "might have audio": PROBE runs first in every transcode flow, so the audio
   * steps get an authoritative answer before they run, and self-skip if there
   * is none.
   */
  hasAudio?: boolean;
}

/** What a media currently holds for one asset step. */
export interface IngestAssetState {
  /** Whether at least one File for this step is linked to the Media. */
  present: boolean;
  /**
   * Lowest `ingestVersion` across the linked Files (a filmstrip or waveform is
   * a set of chunks, and one stale chunk makes the whole set stale). Unstamped
   * files read as `INGEST_BASELINE_VERSION`.
   */
  version?: number;
}

/** Why each step in a backfill plan was selected. */
export interface IngestBackfillPlan {
  /** Expected by the spec, but the media has no such asset. */
  missing: IngestAssetStep[];
  /** Present, but stamped older than the current spec version. */
  outdated: IngestAssetStep[];
  /** `missing` + `outdated`, in `INGEST_ASSET_STEPS` order. */
  steps: IngestAssetStep[];
}

/**
 * Decide which asset steps a media still owes, comparing what a fresh ingest
 * would produce against what it actually holds. Pure — the caller supplies the
 * observed state, so the whole decision is unit-testable.
 *
 * A step is selected when it is expected for the media type and either has no
 * File at all (missing) or its File predates the current spec (outdated).
 */
export function planIngestBackfill(
  facts: IngestMediaFacts,
  assets: Partial<Record<IngestAssetStep, IngestAssetState>>
): IngestBackfillPlan {
  const missing: IngestAssetStep[] = [];
  const outdated: IngestAssetStep[] = [];

  for (const step of expectedIngestSteps(facts)) {
    const state = assets[step];
    if (!state?.present) {
      missing.push(step);
      continue;
    }
    const version = state.version ?? INGEST_BASELINE_VERSION;
    if (version < INGEST_STEP_VERSIONS[step]) {
      outdated.push(step);
    }
  }

  return {
    missing,
    outdated,
    steps: INGEST_ASSET_STEPS.filter(
      (step) => missing.includes(step) || outdated.includes(step)
    ),
  };
}

/**
 * The asset steps this media should have: the media type's ingest steps, minus
 * the audio-dependent ones when PROBE has established there is no audio.
 */
export function expectedIngestSteps(
  facts: IngestMediaFacts
): IngestAssetStep[] {
  const steps = ingestStepsFor(facts.mediaType);
  if (facts.hasAudio === false) {
    return steps.filter((step) => !AUDIO_DEPENDENT_STEPS.includes(step));
  }
  return steps;
}
