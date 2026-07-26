import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import {
  ProcessingProvider,
  type LabelSpeech,
  type LabelTrack,
} from '@project/shared';
import { LabelCacheService } from '../services/label-cache.service';
import { LabelEntityService } from '../services/label-entity.service';
import { SpeechTranscriptionExecutor } from '../executors/speech-transcription.executor';
import { SpeechTranscriptionNormalizer } from '../normalizers/speech-transcription.normalizer';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import type { StepJobData } from '../../queue/types/job.types';
import type { SpeechTranscriptionStepInput } from '../types/step-inputs';
import type { SpeechTranscriptionStepOutput } from '../types/step-outputs';
import type { SpeechTranscriptionResponse } from '../types/executor-responses';
import type {
  LabelTrackData,
  LabelSpeechData,
} from '../types/normalizer-outputs';

// Re-export types for parent processor
export type { SpeechTranscriptionStepInput, SpeechTranscriptionStepOutput };

/**
 * Step processor for SPEECH_TRANSCRIPTION in detect_labels flow
 *
 * This processor:
 * 1. Checks cache before calling executor
 * 2. Calls SpeechTranscriptionExecutor (SPEECH_TRANSCRIPTION)
 * 3. Calls SpeechTranscriptionNormalizer to transform response
 * 4. Upserts LabelEntity records (for speakers)
 * 5. Upserts LabelTrack records (for speaker timelines)
 * 6. Upserts LabelSpeech records (for detailed timing)
 *
 * Steps 4-6 are upserts keyed by content hash, and existing rows have their
 * entity/track links reconciled, so re-running the labels task repairs a media
 * left half-written by an earlier run. A write that cannot be completed fails
 * the step rather than reporting success with a broken label graph.
 * 7. Updates LabelMedia with aggregated data (transcript, word counts)
 * 8. Stores normalized response to cache
 */
@Injectable()
export class SpeechTranscriptionStepProcessor extends BaseStepProcessor<
  SpeechTranscriptionStepInput,
  SpeechTranscriptionStepOutput
> {
  protected readonly logger = new Logger(SpeechTranscriptionStepProcessor.name);
  private readonly processorVersion = 'speech-transcription:1.0.1';

  constructor(
    private readonly labelCacheService: LabelCacheService,
    private readonly labelEntityService: LabelEntityService,
    private readonly speechTranscriptionExecutor: SpeechTranscriptionExecutor,
    private readonly speechTranscriptionNormalizer: SpeechTranscriptionNormalizer,
    private readonly pocketBaseService: PocketBaseService
  ) {
    super();
  }

  /**
   * Process speech transcription with cache awareness
   */
  async process(
    input: SpeechTranscriptionStepInput,
    _job: Job<StepJobData>
  ): Promise<SpeechTranscriptionStepOutput> {
    const startTime = Date.now();

    this.logger.log(
      `Processing speech transcription for media ${input.mediaId}, version ${input.version}`
    );

    try {
      // Step 0: Check if media has audio
      const media = await this.pocketBaseService.getMedia(input.mediaId);
      if (media.hasAudio === false) {
        this.logger.log(
          `Media ${input.mediaId} has no audio track, skipping speech transcription`
        );
        return {
          success: true,
          cacheHit: false,
          processorVersion: this.processorVersion,
          processingTimeMs: Date.now() - startTime,
          counts: {
            transcriptLength: 0,
            wordCount: 0,
            labelEntityCount: 0,
            labelTrackCount: 0,
            labelClipCount: 0,
            labelObjectCount: 0,
            labelFaceCount: 0,
            labelPersonCount: 0,
            labelSpeechCount: 0,
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
        ProcessingProvider.GOOGLE_SPEECH,
        this.processorVersion
      );

      let response: unknown;
      let cacheHit = false;

      if (
        cached &&
        this.labelCacheService.isCacheValid(cached, this.processorVersion)
      ) {
        this.logger.log(
          `Using cached speech transcription for media ${input.mediaId}`
        );
        response = cached.response;
        cacheHit = true;
      } else {
        // Step 2: Cache miss - call executor
        this.logger.log(
          `Cache miss for media ${input.mediaId}, calling Speech Transcription API`
        );

        response = await this.speechTranscriptionExecutor.execute(
          input.workspaceRef,
          input.mediaId,
          input.config
        );

        // Step 7: Store normalized response to cache
        await this.labelCacheService.storeLabelCache(
          input.workspaceRef,
          input.mediaId,
          input.version,
          ProcessingProvider.GOOGLE_SPEECH,
          response,
          this.processorVersion,
          ['SPEECH_TRANSCRIPTION']
        );

        this.logger.log(
          `Speech transcription completed for media ${input.mediaId}, stored to cache`
        );
      }

      // Step 3: Call normalizer to transform response
      const normalizedData = await this.speechTranscriptionNormalizer.normalize(
        {
          response: response as SpeechTranscriptionResponse,
          mediaId: input.mediaId,
          workspaceRef: input.workspaceRef,
          taskRef: input.taskRef,
          version: input.version,
          processor: 'speech-transcription',
          processorVersion: this.processorVersion,
        }
      );

      // Step 4: Batch insert LabelEntity records
      // Map speaker tags to entity IDs
      const entityMap = new Map<number, string>();
      for (const entity of normalizedData.labelEntities) {
        const entityId = await this.labelEntityService.getOrCreateLabelEntity(
          entity.WorkspaceRef,
          entity.labelType,
          entity.canonicalName,
          entity.provider as ProcessingProvider.GOOGLE_SPEECH,
          entity.processor,
          entity.metadata
        );
        const speakerTag =
          (entity.metadata as { speakerTag?: number })?.speakerTag ?? 0;
        entityMap.set(speakerTag, entityId);
      }
      this.logger.debug(`Processed ${entityMap.size} speaker entities`);

      // Step 5: Upsert one LabelTrack per speaker tag.
      // Keyed by speaker tag, never by array position — a positional map
      // silently shifts every later speaker onto the wrong track as soon as
      // one upsert fails.
      const tracksToUpsert = (normalizedData.labelTracks || []).map((track) => {
        const speakerTag =
          (track.trackData as { speakerTag?: number })?.speakerTag ?? 0;
        return {
          speakerTag,
          data: { ...track, LabelEntityRef: entityMap.get(speakerTag) },
        };
      });

      const tracks = await this.upsertLabelTracks(tracksToUpsert);
      this.logger.debug(
        `Upserted ${tracks.idsBySpeakerTag.size} of ${tracksToUpsert.length} speaker tracks`
      );

      // Step 6: Upsert LabelSpeech records
      // Link speech to entities and tracks
      const speechToUpsert = (normalizedData.labelSpeech || []).map(
        (speech) => {
          const speakerTag = speech.speakerTag ?? 0;
          return {
            ...speech,
            LabelEntityRef: entityMap.get(speakerTag),
            LabelTrackRef: tracks.idsBySpeakerTag.get(speakerTag),
          };
        }
      );

      const speech = await this.upsertLabelSpeech(speechToUpsert);
      this.logger.debug(
        `Upserted ${speech.ids.length} of ${speechToUpsert.length} label speech segments`
      );

      // Clear entity cache after processing
      this.labelEntityService.clearCache();

      // A speaker with no LabelTrack row cannot be linked to an Entity in the
      // UI, so a partial write is a failed step. Segments are written first so
      // the transcript survives; the retry is cheap and idempotent (cached
      // provider response, hash-keyed upserts).
      if (tracks.failed > 0 || speech.failed > 0) {
        throw new Error(
          `Speech transcription persisted incompletely for media ${input.mediaId}: ` +
            `${tracks.failed} of ${tracksToUpsert.length} tracks and ` +
            `${speech.failed} of ${speechToUpsert.length} segments failed to write`
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
          labelEntityCount: entityMap.size,
          labelTrackCount: tracks.idsBySpeakerTag.size,
          labelClipCount: 0, // No longer creating clips
          labelObjectCount: 0,
          labelFaceCount: 0,
          labelPersonCount: 0,
          labelSpeechCount: speech.ids.length,
          labelSegmentCount: 0,
          labelShotCount: 0,
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Speech transcription failed for media ${input.mediaId}: ${errorMessage}`
      );

      // Rethrow so processStepJob produces a status: 'failed' StepResult.
      // Swallowing this into a success:false output makes the parent's
      // partial-success accounting count a failed step as completed.
      throw error;
    }
  }

  /**
   * Upsert one LabelTrack per speaker tag, keyed by trackHash.
   *
   * Returns the record id for every speaker tag whose track is now in the DB,
   * so callers can link segments by tag rather than by array position.
   * Existing tracks have their provider cluster link reconciled so a re-run
   * repairs rows left unlinked by an earlier partial write; `EntityRef` — the
   * editor's manual link — is never touched.
   */
  private async upsertLabelTracks(
    tracks: Array<{ speakerTag: number; data: LabelTrackData }>
  ): Promise<{ idsBySpeakerTag: Map<number, string>; failed: number }> {
    const idsBySpeakerTag = new Map<number, string>();
    let failed = 0;

    for (const { speakerTag, data } of tracks) {
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
          idsBySpeakerTag.set(speakerTag, existing.id);
          continue;
        }

        const created =
          await this.pocketBaseService.labelTrackMutator.create(data);
        idsBySpeakerTag.set(speakerTag, created.id);
      } catch (error) {
        // A concurrent run of this step can win the race between our lookup
        // and our create; the row it wrote is the one we want. Without this
        // recovery the track was dropped and its segments lost LabelTrackRef.
        if (this.isUniqueConstraintError(error)) {
          const existing = await this.findTrackByHash(data.trackHash);
          if (existing) {
            idsBySpeakerTag.set(speakerTag, existing.id);
            continue;
          }
        }
        failed += 1;
        this.logger.error(
          `Failed to upsert speaker track ${speakerTag} (trackHash=${data.trackHash}) ` +
            `for media ${data.MediaRef}: ${this.formatPbError(error)}`
        );
      }
    }

    return { idsBySpeakerTag, failed };
  }

  /**
   * Upsert LabelSpeech records, keyed by speechHash. Existing segments have
   * their entity/track links reconciled so a re-run repairs segments written
   * by an earlier run whose tracks failed.
   */
  private async upsertLabelSpeech(
    speechSegments: LabelSpeechData[]
  ): Promise<{ ids: string[]; failed: number }> {
    const ids: string[] = [];
    let failed = 0;

    for (const speechData of speechSegments) {
      try {
        const existing = await this.findSpeechByHash(speechData.speechHash);
        if (existing) {
          await this.relinkSpeech(existing, speechData);
          ids.push(existing.id);
          continue;
        }

        const created =
          await this.pocketBaseService.labelSpeechMutator.create(speechData);
        ids.push(created.id);
      } catch (error) {
        if (this.isUniqueConstraintError(error)) {
          const existing = await this.findSpeechByHash(speechData.speechHash);
          if (existing) {
            await this.relinkSpeech(existing, speechData);
            ids.push(existing.id);
            continue;
          }
        }
        failed += 1;
        this.logger.error(
          `Failed to upsert speech segment (speechHash=${speechData.speechHash}) ` +
            `for media ${speechData.MediaRef}: ${this.formatPbError(error)}`
        );
      }
    }

    return { ids, failed };
  }

  /** Patch an existing segment's entity/track links when they drifted. */
  private async relinkSpeech(
    existing: LabelSpeech,
    desired: LabelSpeechData
  ): Promise<void> {
    const patch: Partial<LabelSpeech> = {};
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
    await this.pocketBaseService.labelSpeechMutator.update(existing.id, patch);
  }

  private async findTrackByHash(trackHash: string): Promise<LabelTrack | null> {
    const result = await this.pocketBaseService.labelTrackMutator.getList(
      1,
      1,
      `trackHash = "${trackHash}"`
    );
    return result.items[0] ?? null;
  }

  private async findSpeechByHash(
    speechHash: string
  ): Promise<LabelSpeech | null> {
    const result = await this.pocketBaseService.labelSpeechMutator.getList(
      1,
      1,
      `speechHash = "${speechHash}"`
    );
    return result.items[0] ?? null;
  }

  /**
   * Log-friendly error string that keeps PocketBase's field-level detail.
   * A ClientResponseError's `.message` is only the generic envelope; the
   * actionable per-field reasons live in `error.response.data`.
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
   * Recognize a unique-constraint violation. PocketBase reports
   * `validation_not_unique` in `error.response.data.<field>.code`, never in
   * `error.message`, so both are searched.
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
      haystack.includes('speechHash')
    );
  }
}
