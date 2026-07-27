import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import * as fs from 'fs';
import * as path from 'path';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import {
  ProcessingProvider,
  FileStatus,
  type LabelSpeaker,
  type LabelTrack,
  type Media,
} from '@project/shared';
import { LabelCacheService } from '../services/label-cache.service';
import { LabelEntityService } from '../services/label-entity.service';
import { SpeakerTranscriptionExecutor } from '../executors/speaker-transcription.executor';
import { SpeakerTranscriptionNormalizer } from '../normalizers/speaker-transcription.normalizer';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import { StorageService } from '../../shared/services/storage.service';
import type { StepJobData } from '../../queue/types/job.types';
import type { SpeakerTranscriptionStepInput } from '../types/step-inputs';
import type { SpeakerTranscriptionStepOutput } from '../types/step-outputs';
import type { SpeakerTranscriptionResponse } from '../types/executor-responses';
import type {
  LabelTrackData,
  LabelSpeakerData,
} from '../types/normalizer-outputs';

// Re-export types for parent processor
export type { SpeakerTranscriptionStepInput, SpeakerTranscriptionStepOutput };

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

/**
 * Total window and poll interval for the in-process wait on the transcode
 * outputs (see waitForAudioReadiness). Read from the environment on each call
 * so deployments can tune them without a rebuild.
 */
const AUDIO_READY_WAIT_MS_DEFAULT = 120_000;
const AUDIO_READY_POLL_MS_DEFAULT = 3_000;

/**
 * Step processor for SPEAKER_TRANSCRIPTION in detect_labels flow
 *
 * This processor:
 * 1. Checks cache before calling executor
 * 2. Calls SpeakerTranscriptionExecutor (ElevenLabs Scribe, diarize: true),
 *    preferring the transcode audio proxy (Media.audioFileRef) over the
 *    original file
 * 3. Calls SpeakerTranscriptionNormalizer to transform response
 * 4. Upserts LabelEntity records (one per speaker)
 * 5. Upserts LabelTrack records (one per speaker)
 * 6. Upserts LabelSpeaker records (per-utterance, word-precise timing)
 * 7. Stores normalized response to cache
 *
 * Steps 4-6 are upserts keyed by content hash, and existing rows have their
 * entity/track links reconciled, so re-running the labels task repairs a media
 * left half-written by an earlier run. A write that cannot be completed fails
 * the step rather than reporting success with a broken label graph.
 */
@Injectable()
export class SpeakerTranscriptionStepProcessor extends BaseStepProcessor<
  SpeakerTranscriptionStepInput,
  SpeakerTranscriptionStepOutput
> {
  protected readonly logger = new Logger(
    SpeakerTranscriptionStepProcessor.name
  );
  private readonly processorVersion = 'speaker-transcription:1.0.0';

  constructor(
    private readonly labelCacheService: LabelCacheService,
    private readonly labelEntityService: LabelEntityService,
    private readonly speakerTranscriptionExecutor: SpeakerTranscriptionExecutor,
    private readonly speakerTranscriptionNormalizer: SpeakerTranscriptionNormalizer,
    private readonly pocketBaseService: PocketBaseService,
    private readonly storageService: StorageService
  ) {
    super();
  }

  /**
   * Process speaker transcription with cache awareness
   */
  async process(
    input: SpeakerTranscriptionStepInput,
    _job: Job<StepJobData>
  ): Promise<SpeakerTranscriptionStepOutput> {
    const startTime = Date.now();

    this.logger.log(
      `Processing speaker transcription for media ${input.mediaId}, version ${input.version}`
    );

    try {
      // Step 0: Wait (bounded, in-process) for the transcode task to determine
      // audio presence (PROBE) and produce the audio-only proxy (AUDIO ->
      // Media.audioFileRef) before deciding. Keeps the labels and transcode
      // tasks decoupled (no cross-task dependency) while ensuring we neither
      // run speaker detection on silent media nor upload the full original
      // file to ElevenLabs when a small audio proxy is moments away.
      const { decision, media } = await this.waitForAudioReadiness(
        input.mediaId
      );
      if (decision === 'skip') {
        this.logger.log(
          `Media ${input.mediaId} has no audio track, skipping speaker transcription`
        );
        return {
          success: true,
          cacheHit: false,
          processorVersion: this.processorVersion,
          processingTimeMs: Date.now() - startTime,
          counts: {
            transcriptLength: 0,
            wordCount: 0,
            speakerCount: 0,
            labelEntityCount: 0,
            labelTrackCount: 0,
            labelClipCount: 0,
            labelObjectCount: 0,
            labelFaceCount: 0,
            labelPersonCount: 0,
            labelSpeechCount: 0,
            labelSpeakerCount: 0,
            labelSegmentCount: 0,
            labelShotCount: 0,
          },
        };
      }

      // Step 1: Check cache before calling executor
      const cached = await this.labelCacheService.getCachedLabels(
        input.workspaceRef,
        input.mediaId,
        input.version,
        ProcessingProvider.ELEVENLABS,
        this.processorVersion
      );

      let response: unknown;
      let cacheHit = false;

      if (
        cached &&
        this.labelCacheService.isCacheValid(cached, this.processorVersion)
      ) {
        this.logger.log(
          `Using cached speaker transcription for media ${input.mediaId}`
        );
        response = cached.response;
        cacheHit = true;
      } else {
        // Step 2: Cache miss - call executor
        this.logger.log(
          `Cache miss for media ${input.mediaId}, calling ElevenLabs STT API`
        );

        // Lease the media temp dir across BOTH the proxy download and the
        // executor's provider upload, so a concurrent sibling step's
        // cleanupTemp can't delete the proxy in the gap between the two.
        response = await this.storageService.withTempLease(
          input.mediaId,
          async () => {
            // Prefer the audio-only proxy rendered by the transcode task
            // (Media.audioFileRef). Resolves to undefined on any issue, in
            // which case the executor uses the original file (input.fileRef).
            const audioProxyPath = await this.resolveAudioProxy(media);

            return this.speakerTranscriptionExecutor.execute(
              input.workspaceRef,
              input.mediaId,
              input.fileRef,
              input.config,
              audioProxyPath
            );
          }
        );

        // Step 7: Store normalized response to cache
        await this.labelCacheService.storeLabelCache(
          input.workspaceRef,
          input.mediaId,
          input.version,
          ProcessingProvider.ELEVENLABS,
          response,
          this.processorVersion,
          ['SPEAKER_TRANSCRIPTION']
        );

        this.logger.log(
          `Speaker transcription completed for media ${input.mediaId}, stored to cache`
        );
      }

      // Step 3: Call normalizer to transform response
      const normalizedData =
        await this.speakerTranscriptionNormalizer.normalize({
          response: response as SpeakerTranscriptionResponse,
          mediaId: input.mediaId,
          workspaceRef: input.workspaceRef,
          taskRef: input.taskRef,
          version: input.version,
          processor: 'speaker-transcription',
          processorVersion: this.processorVersion,
        });

      // Step 4: Resolve one LabelEntity per speaker, scoped to this media.
      // Keyed by the provider speaker id, which is the entity's instanceId —
      // so "Speaker 1" here is a different record from "Speaker 1" in any
      // other media, and identifying one never claims the other.
      const entityMap = await this.labelEntityService.resolveEntities(
        normalizedData.labelEntities
      );
      this.logger.debug(`Processed ${entityMap.size} speaker entities`);

      // Step 5: Upsert one LabelTrack per speaker.
      // The track is what the editor links to an Entity ("this speaker is
      // Erik"), and the UI finds it by trackId == the provider speaker id, so
      // the mapping below must be keyed by speaker id — never by array
      // position, which silently shifts every later speaker onto the wrong
      // track when one upsert fails.
      const tracksToUpsert = (normalizedData.labelTracks || []).map((track) => {
        const speakerId =
          (track.trackData as { speakerId?: string })?.speakerId ??
          track.trackId;
        return {
          speakerId,
          data: { ...track, LabelEntityRef: entityMap.get(speakerId) },
        };
      });

      const tracks = await this.upsertLabelTracks(tracksToUpsert);
      this.logger.debug(
        `Upserted ${tracks.idsBySpeakerId.size} of ${tracksToUpsert.length} speaker tracks`
      );

      // Step 6: Upsert LabelSpeaker records
      // Link utterances to entities and tracks
      const speakersToUpsert = (normalizedData.labelSpeakers || []).map(
        (speaker) => ({
          ...speaker,
          LabelEntityRef: entityMap.get(speaker.speakerId),
          LabelTrackRef: tracks.idsBySpeakerId.get(speaker.speakerId),
        })
      );

      const speakers = await this.upsertLabelSpeakers(speakersToUpsert);
      this.logger.debug(
        `Upserted ${speakers.ids.length} of ${speakersToUpsert.length} speaker utterances`
      );

      // A speaker with no LabelTrack row cannot be identified in the UI at all
      // (the track carries the Entity link), so a partial write is a failed
      // step, not a successful one — reporting success here is what let this
      // reach an editor as a silently unusable "No track record". Utterances
      // are written before this check so the transcript survives, and the
      // retry is cheap and idempotent: the provider response comes from the
      // cache and every write above upserts by hash.
      if (tracks.failed > 0 || speakers.failed > 0) {
        throw new Error(
          `Speaker transcription persisted incompletely for media ${input.mediaId}: ` +
            `${tracks.failed} of ${tracksToUpsert.length} tracks and ` +
            `${speakers.failed} of ${speakersToUpsert.length} utterances failed to write`
        );
      }

      const processingTimeMs = Date.now() - startTime;

      return {
        success: true,
        cacheHit,
        processorVersion: this.processorVersion,
        processingTimeMs,
        counts: {
          transcriptLength:
            normalizedData.labelMediaUpdate.transcriptLength || 0,
          wordCount: normalizedData.labelMediaUpdate.wordCount || 0,
          speakerCount: normalizedData.labelMediaUpdate.speakerCount || 0,
          labelEntityCount: entityMap.size,
          labelTrackCount: tracks.idsBySpeakerId.size,
          labelClipCount: 0,
          labelObjectCount: 0,
          labelFaceCount: 0,
          labelPersonCount: 0,
          labelSpeechCount: 0,
          labelSpeakerCount: speakers.ids.length,
          labelSegmentCount: 0,
          labelShotCount: 0,
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Speaker transcription failed for media ${input.mediaId}: ${errorMessage}`
      );

      // Rethrow so processStepJob produces a status: 'failed' StepResult.
      // Swallowing this into a success:false output makes the parent's
      // partial-success accounting count a failed step as completed.
      throw error;
    }
  }

  /**
   * Wait (in-process, bounded by AUDIO_READY_WAIT_MS) for the transcode task to
   * produce the two facts this step depends on, then return a decision:
   *   - 'skip'    -> PROBE has run and the media has no audio track;
   *   - 'proceed' -> PROBE has run, audio is present, and the audio proxy
   *                  (Media.audioFileRef) is AVAILABLE.
   *
   * `hasAudio` is only authoritative once PROBE has run. The ingest placeholder
   * Media is created with hasAudio:true and duration:0, and PROBE writes a real
   * duration for every video/audio file (images never reach this step), so
   * `duration > 0` is our "PROBE has run" signal.
   *
   * On timeout it returns 'proceed' regardless; resolveAudioProxy() will then
   * find no available proxy and the executor falls back to the original upload.
   */
  private async waitForAudioReadiness(
    mediaId: string
  ): Promise<{ decision: 'skip' | 'proceed'; media: Media }> {
    const waitMs = parsePositiveInt(
      process.env.SPEAKER_TRANSCRIPTION_AUDIO_WAIT_MS,
      AUDIO_READY_WAIT_MS_DEFAULT
    );
    const pollMs = parsePositiveInt(
      process.env.SPEAKER_TRANSCRIPTION_AUDIO_POLL_MS,
      AUDIO_READY_POLL_MS_DEFAULT
    );
    const deadline = Date.now() + waitMs;
    let media = await this.pocketBaseService.getMedia(mediaId);
    let waitLogged = false;

    for (;;) {
      const probeComplete = media.duration > 0;

      if (probeComplete) {
        if (media.hasAudio === false) {
          return { decision: 'skip', media };
        }
        if (await this.isAudioProxyAvailable(media)) {
          return { decision: 'proceed', media };
        }
      }

      if (Date.now() >= deadline) {
        this.logger.warn(
          `Audio proxy for media ${mediaId} not ready after ${waitMs}ms ` +
            `(probeComplete=${probeComplete}, hasAudio=${media.hasAudio}); ` +
            `proceeding, executor will fall back to the original upload`
        );
        return { decision: 'proceed', media };
      }

      if (!waitLogged) {
        this.logger.debug(
          `Waiting for transcode audio proxy for media ${mediaId} (probeComplete=${probeComplete})`
        );
        waitLogged = true;
      }

      await this.sleep(pollMs);
      media = await this.pocketBaseService.getMedia(mediaId);
    }
  }

  /**
   * Cheap readiness probe for the audio-only proxy: the ref must be set and its
   * File record AVAILABLE with a stored blob. Does NOT download (that happens
   * in resolveAudioProxy once we commit to running).
   */
  private async isAudioProxyAvailable(media: Media): Promise<boolean> {
    if (!media.audioFileRef) {
      return false;
    }
    try {
      const file = await this.pocketBaseService.getFile(media.audioFileRef);
      return !!file && file.fileStatus === FileStatus.AVAILABLE && !!file.file;
    } catch {
      return false;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Resolve the transcode-generated audio-only proxy (Media.audioFileRef) to
   * a local temp file for the executor to upload.
   *
   * Returns undefined on any issue (missing ref, File record not AVAILABLE,
   * download failure, empty file) so the caller falls back to the original
   * file. The download lands in the media's worker-temp directory, which the
   * executor removes via cleanupTemp() when the step finishes.
   */
  private async resolveAudioProxy(media: Media): Promise<string | undefined> {
    if (!media.audioFileRef) {
      return undefined;
    }

    try {
      const file = await this.pocketBaseService.getFile(media.audioFileRef);
      if (!file) {
        this.logger.warn(
          `Audio proxy file record ${media.audioFileRef} not found for media ${media.id}, falling back to original file`
        );
        return undefined;
      }

      if (file.fileStatus !== FileStatus.AVAILABLE || !file.file) {
        this.logger.warn(
          `Audio proxy file ${file.id} for media ${media.id} is not available (status: ${file.fileStatus}), falling back to original file`
        );
        return undefined;
      }

      const tempDir = await this.storageService.createTempDir(media.id);
      // Prefix with the File id so the proxy can never collide with the
      // original's temp download in the same directory.
      const destPath = path.join(tempDir, `${file.id}-${file.name || 'audio'}`);
      await this.pocketBaseService.downloadFileToPath(file, destPath);

      const stat = await fs.promises.stat(destPath);
      if (stat.size === 0) {
        this.logger.warn(
          `Audio proxy file ${file.id} for media ${media.id} downloaded empty, falling back to original file`
        );
        return undefined;
      }

      this.logger.log(
        `Resolved audio proxy for media ${media.id}: ${destPath} (${stat.size} bytes)`
      );
      return destPath;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to resolve audio proxy for media ${media.id}, falling back to original file: ${message}`
      );
      return undefined;
    }
  }

  /**
   * Upsert one LabelTrack per speaker, keyed by trackHash.
   *
   * Returns the record id for every speaker whose track is now in the DB —
   * whether it was created here or already existed — so callers can link
   * utterances by speaker id rather than by array position.
   *
   * Existing tracks are reconciled, not just reused: a run that failed to
   * write its tracks leaves utterances with no LabelTrackRef, and re-running
   * the task is the documented repair path, so the LabelEntity link is
   * refreshed on the way through. Only that ref is written — the editor's
   * manual "this speaker is Erik" link lives on the LabelEntity itself, and
   * re-labelling reuses that row by entityHash, so it survives regeneration.
   */
  private async upsertLabelTracks(
    tracks: Array<{ speakerId: string; data: LabelTrackData }>
  ): Promise<{ idsBySpeakerId: Map<string, string>; failed: number }> {
    const idsBySpeakerId = new Map<string, string>();
    let failed = 0;

    for (const { speakerId, data } of tracks) {
      try {
        const existing = await this.findTrackByHash(data.trackHash);
        if (existing) {
          if (
            data.LabelEntityRef &&
            existing.LabelEntityRef !== data.LabelEntityRef
          ) {
            await this.pocketBaseService.labelTrackMutator.update(existing.id, {
              LabelEntityRef: data.LabelEntityRef,
            } as Partial<LabelTrack>);
          }
          idsBySpeakerId.set(speakerId, existing.id);
          continue;
        }

        const created =
          await this.pocketBaseService.labelTrackMutator.create(data);
        idsBySpeakerId.set(speakerId, created.id);
      } catch (error) {
        // A concurrent run of this step (retry, watchdog takeback) can win the
        // race between our lookup and our create; the row it wrote is the one
        // we want. Without this recovery the track was dropped outright and
        // every utterance for the speaker lost its LabelTrackRef.
        if (this.isUniqueConstraintError(error)) {
          const existing = await this.findTrackByHash(data.trackHash);
          if (existing) {
            idsBySpeakerId.set(speakerId, existing.id);
            continue;
          }
        }
        failed += 1;
        this.logger.error(
          `Failed to upsert speaker track "${speakerId}" (trackHash=${data.trackHash}) ` +
            `for media ${data.MediaRef}: ${this.formatPbError(error)}`
        );
      }
    }

    return { idsBySpeakerId, failed };
  }

  /**
   * Upsert LabelSpeaker records, keyed by speakerHash.
   *
   * Existing utterances have their entity/track links reconciled so a re-run
   * repairs rows written by an earlier run whose tracks failed (the link
   * fields were left empty then, and blindly reusing the row would keep them
   * empty forever).
   */
  private async upsertLabelSpeakers(
    utterances: LabelSpeakerData[]
  ): Promise<{ ids: string[]; failed: number }> {
    const ids: string[] = [];
    let failed = 0;

    for (const speakerData of utterances) {
      try {
        const existing = await this.findSpeakerByHash(speakerData.speakerHash);
        if (existing) {
          await this.relinkSpeaker(existing, speakerData);
          ids.push(existing.id);
          continue;
        }

        const created =
          await this.pocketBaseService.labelSpeakerMutator.create(speakerData);
        ids.push(created.id);
      } catch (error) {
        if (this.isUniqueConstraintError(error)) {
          const existing = await this.findSpeakerByHash(
            speakerData.speakerHash
          );
          if (existing) {
            await this.relinkSpeaker(existing, speakerData);
            ids.push(existing.id);
            continue;
          }
        }
        failed += 1;
        this.logger.error(
          `Failed to upsert speaker utterance (speakerHash=${speakerData.speakerHash}) ` +
            `for media ${speakerData.MediaRef}: ${this.formatPbError(error)}`
        );
      }
    }

    return { ids, failed };
  }

  /** Patch an existing utterance's entity/track links when they drifted. */
  private async relinkSpeaker(
    existing: LabelSpeaker,
    desired: LabelSpeakerData
  ): Promise<void> {
    const patch: Partial<LabelSpeaker> = {};
    if (
      desired.LabelTrackRef &&
      existing.LabelTrackRef !== desired.LabelTrackRef
    ) {
      patch.LabelTrackRef = desired.LabelTrackRef;
    }
    if (
      desired.LabelEntityRef &&
      existing.LabelEntityRef !== desired.LabelEntityRef
    ) {
      patch.LabelEntityRef = desired.LabelEntityRef;
    }
    if (Object.keys(patch).length === 0) {
      return;
    }
    await this.pocketBaseService.labelSpeakerMutator.update(existing.id, patch);
  }

  private async findTrackByHash(trackHash: string): Promise<LabelTrack | null> {
    const result = await this.pocketBaseService.labelTrackMutator.getList(
      1,
      1,
      `trackHash = "${trackHash}"`
    );
    return result.items[0] ?? null;
  }

  private async findSpeakerByHash(
    speakerHash: string
  ): Promise<LabelSpeaker | null> {
    const result = await this.pocketBaseService.labelSpeakerMutator.getList(
      1,
      1,
      `speakerHash = "${speakerHash}"`
    );
    return result.items[0] ?? null;
  }

  /**
   * Log-friendly error string that keeps PocketBase's field-level detail.
   *
   * A ClientResponseError's `.message` is always the generic envelope
   * ("Failed to create record."); the actionable per-field reasons live in
   * `error.response.data`. Logging only the message is why a failed track
   * write looked like a run with no errors at all.
   */
  private formatPbError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    const data = (error as { response?: { data?: unknown } })?.response?.data;
    if (data && typeof data === 'object' && Object.keys(data).length > 0) {
      return `${message} — ${JSON.stringify(data)}`;
    }
    return message;
  }

  /**
   * Recognize a unique-constraint violation.
   *
   * PocketBase reports `validation_not_unique` in
   * `error.response.data.<field>.code`, never in `error.message`, so both the
   * message and the serialized body are searched.
   */
  private isUniqueConstraintError(error: unknown): boolean {
    if (!error) return false;

    const message = error instanceof Error ? error.message : String(error);
    const data = (error as { response?: { data?: unknown } })?.response?.data;
    const haystack = `${message} ${data ? JSON.stringify(data) : ''}`;

    return (
      haystack.includes('unique constraint') ||
      haystack.includes('UNIQUE constraint') ||
      haystack.includes('validation_not_unique') ||
      haystack.includes('trackHash') ||
      haystack.includes('speakerHash')
    );
  }
}
