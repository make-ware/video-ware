import { describe, expect, it } from 'vitest';
import { MediaType } from '../../enums';
import { TranscodeStepType } from '../transcode/types';
import {
  INGEST_ASSET_STEPS,
  INGEST_BASELINE_VERSION,
  INGEST_STEP_VERSIONS,
  buildIngestTranscodeConfig,
  expectedIngestSteps,
  ingestMeta,
  ingestStepsFor,
  pickIngestTranscodeConfig,
  planIngestBackfill,
  type IngestAssetStep,
} from '../transcode/ingest-spec';

const ALL_CURRENT = Object.fromEntries(
  INGEST_ASSET_STEPS.map((step) => [
    step,
    { present: true, version: INGEST_STEP_VERSIONS[step] },
  ])
) as Record<IngestAssetStep, { present: boolean; version: number }>;

describe('buildIngestTranscodeConfig', () => {
  it('requests every asset for video', () => {
    const config = buildIngestTranscodeConfig(MediaType.VIDEO);

    expect(config.thumbnail).toBeDefined();
    expect(config.sprite).toEqual({
      fps: 1,
      cols: 10,
      rows: 10,
      tileWidth: 320,
      tileHeight: 180,
    });
    expect(config.filmstrip).toBeDefined();
    expect(config.waveform).toBeDefined();
    expect(config.transcode?.enabled).toBe(true);
    expect(config.audio?.enabled).toBe(true);
    expect(config.autocrop?.enabled).toBe(true);
  });

  it('drops frame-based assets for audio', () => {
    const config = buildIngestTranscodeConfig(MediaType.AUDIO);

    expect(config.thumbnail).toBeUndefined();
    expect(config.sprite).toBeUndefined();
    expect(config.filmstrip).toBeUndefined();
    expect(config.waveform).toBeDefined();
    expect(config.transcode?.enabled).toBe(false);
    expect(config.audio?.enabled).toBe(true);
    // No frame to inspect.
    expect(config.autocrop?.enabled).toBe(false);
  });

  it('gives images a single-tile sprite and no time-based assets', () => {
    const config = buildIngestTranscodeConfig(MediaType.IMAGE);

    expect(config.sprite).toEqual({
      fps: 1,
      cols: 1,
      rows: 1,
      tileWidth: 320,
      tileHeight: 180,
    });
    expect(config.thumbnail).toBeDefined();
    expect(config.filmstrip).toBeUndefined();
    expect(config.waveform).toBeUndefined();
    expect(config.transcode?.enabled).toBe(false);
    expect(config.audio?.enabled).toBe(false);
    // A still is one cropdetect sample, indistinguishable from a dark
    // composition.
    expect(config.autocrop?.enabled).toBe(false);
  });

  it('keeps autocrop out of the backfillable asset steps', () => {
    // AUTOCROP writes Media.cropSuggestion/crop rather than a File, so it has
    // nowhere to carry an ingestVersion. It must stay out of the step list, and
    // out of every picked config, or the weekly sweep would re-run cropdetect
    // over the library and rewrite recommendations an editor may have acted on.
    expect(INGEST_ASSET_STEPS).not.toContain(TranscodeStepType.AUTOCROP);
    expect(ingestStepsFor(MediaType.VIDEO)).not.toContain(
      TranscodeStepType.AUTOCROP
    );
    expect(
      pickIngestTranscodeConfig(MediaType.VIDEO, INGEST_ASSET_STEPS).autocrop
    ).toBeUndefined();
  });
});

describe('ingestStepsFor', () => {
  it('derives the step list from the config, honouring enabled flags', () => {
    expect(ingestStepsFor(MediaType.VIDEO)).toEqual([
      TranscodeStepType.THUMBNAIL,
      TranscodeStepType.SPRITE,
      TranscodeStepType.FILMSTRIP,
      TranscodeStepType.WAVEFORM,
      TranscodeStepType.TRANSCODE,
      TranscodeStepType.AUDIO,
    ]);
    expect(ingestStepsFor(MediaType.AUDIO)).toEqual([
      TranscodeStepType.WAVEFORM,
      TranscodeStepType.AUDIO,
    ]);
    expect(ingestStepsFor(MediaType.IMAGE)).toEqual([
      TranscodeStepType.THUMBNAIL,
      TranscodeStepType.SPRITE,
    ]);
  });
});

describe('expectedIngestSteps', () => {
  it('drops the audio-derived steps when the probe found no audio', () => {
    expect(
      expectedIngestSteps({ mediaType: MediaType.VIDEO, hasAudio: false })
    ).toEqual([
      TranscodeStepType.THUMBNAIL,
      TranscodeStepType.SPRITE,
      TranscodeStepType.FILMSTRIP,
      TranscodeStepType.TRANSCODE,
    ]);
  });

  it('keeps them when audio presence is unknown (never probed)', () => {
    expect(expectedIngestSteps({ mediaType: MediaType.VIDEO })).toContain(
      TranscodeStepType.WAVEFORM
    );
  });
});

describe('planIngestBackfill', () => {
  it('plans nothing when every expected asset is current', () => {
    const plan = planIngestBackfill(
      { mediaType: MediaType.VIDEO, hasAudio: true },
      ALL_CURRENT
    );

    expect(plan.steps).toEqual([]);
    expect(plan.missing).toEqual([]);
    expect(plan.outdated).toEqual([]);
  });

  it('reports an absent asset as missing', () => {
    const plan = planIngestBackfill(
      { mediaType: MediaType.VIDEO, hasAudio: true },
      { ...ALL_CURRENT, [TranscodeStepType.WAVEFORM]: { present: false } }
    );

    expect(plan.missing).toEqual([TranscodeStepType.WAVEFORM]);
    expect(plan.outdated).toEqual([]);
    expect(plan.steps).toEqual([TranscodeStepType.WAVEFORM]);
  });

  it('reports an asset stamped below the current version as outdated', () => {
    const plan = planIngestBackfill(
      { mediaType: MediaType.VIDEO, hasAudio: true },
      {
        ...ALL_CURRENT,
        [TranscodeStepType.TRANSCODE]: {
          present: true,
          version: INGEST_STEP_VERSIONS[TranscodeStepType.TRANSCODE] - 1,
        },
      }
    );

    expect(plan.outdated).toEqual([TranscodeStepType.TRANSCODE]);
    expect(plan.missing).toEqual([]);
  });

  it('treats an unstamped legacy asset as the baseline version', () => {
    const plan = planIngestBackfill(
      { mediaType: MediaType.VIDEO, hasAudio: true },
      {
        ...ALL_CURRENT,
        [TranscodeStepType.SPRITE]: { present: true, version: undefined },
      }
    );

    // Only a bump past the baseline should sweep legacy files in; at the
    // current versions an unstamped file is current.
    const spriteIsBaseline =
      INGEST_STEP_VERSIONS[TranscodeStepType.SPRITE] ===
      INGEST_BASELINE_VERSION;
    expect(plan.steps.includes(TranscodeStepType.SPRITE)).toBe(
      !spriteIsBaseline
    );
  });

  it('never asks a silent video for waveform or audio assets', () => {
    const plan = planIngestBackfill(
      { mediaType: MediaType.VIDEO, hasAudio: false },
      {
        [TranscodeStepType.THUMBNAIL]: { present: true },
        [TranscodeStepType.SPRITE]: { present: true },
        [TranscodeStepType.FILMSTRIP]: { present: true },
        [TranscodeStepType.TRANSCODE]: { present: true },
      }
    );

    expect(plan.steps).toEqual([]);
  });

  it('never asks an image for a filmstrip, waveform or proxy', () => {
    const plan = planIngestBackfill({ mediaType: MediaType.IMAGE }, {});

    expect(plan.steps).toEqual([
      TranscodeStepType.THUMBNAIL,
      TranscodeStepType.SPRITE,
    ]);
  });

  it('orders steps by INGEST_ASSET_STEPS regardless of discovery order', () => {
    const plan = planIngestBackfill(
      { mediaType: MediaType.VIDEO, hasAudio: true },
      {
        ...ALL_CURRENT,
        [TranscodeStepType.AUDIO]: { present: false },
        [TranscodeStepType.THUMBNAIL]: {
          present: true,
          version: INGEST_STEP_VERSIONS[TranscodeStepType.THUMBNAIL] - 1,
        },
      }
    );

    expect(plan.steps).toEqual([
      TranscodeStepType.THUMBNAIL,
      TranscodeStepType.AUDIO,
    ]);
  });
});

describe('pickIngestTranscodeConfig', () => {
  it('keeps only the requested steps, with the ingest geometry', () => {
    const config = pickIngestTranscodeConfig(MediaType.VIDEO, [
      TranscodeStepType.WAVEFORM,
    ]);

    expect(config.waveform).toEqual(
      buildIngestTranscodeConfig(MediaType.VIDEO).waveform
    );
    expect(config.thumbnail).toBeUndefined();
    expect(config.sprite).toBeUndefined();
    expect(config.filmstrip).toBeUndefined();
    expect(config.transcode).toBeUndefined();
    expect(config.audio).toBeUndefined();
  });

  it('drops steps the media type does not support', () => {
    const config = pickIngestTranscodeConfig(MediaType.IMAGE, [
      TranscodeStepType.WAVEFORM,
      TranscodeStepType.TRANSCODE,
      TranscodeStepType.THUMBNAIL,
    ]);

    expect(config.waveform).toBeUndefined();
    expect(config.transcode).toBeUndefined();
    expect(config.thumbnail).toBeDefined();
  });

  it('round-trips every step of every media type', () => {
    for (const mediaType of [
      MediaType.VIDEO,
      MediaType.AUDIO,
      MediaType.IMAGE,
    ]) {
      const steps = ingestStepsFor(mediaType);
      const config = pickIngestTranscodeConfig(mediaType, steps);
      expect(config).toEqual(
        // The full config minus the media type's disabled `enabled: false`
        // blocks, which pick drops entirely.
        pickIngestTranscodeConfig(mediaType, INGEST_ASSET_STEPS)
      );
    }
  });
});

describe('ingestMeta', () => {
  it('stamps the current version for the step', () => {
    expect(ingestMeta(TranscodeStepType.WAVEFORM)).toEqual({
      ingestVersion: INGEST_STEP_VERSIONS[TranscodeStepType.WAVEFORM],
    });
  });
});
