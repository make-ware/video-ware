/**
 * Speaker Transcription Executor
 *
 * Executes ElevenLabs Scribe speech-to-text calls with speaker diarization
 * for the SPEAKER_TRANSCRIPTION step. This is a pure strategy implementation
 * with no database operations.
 *
 * Unlike the GCVI executors, the file is streamed to the provider directly
 * from app storage (local path, or a temp download in S3 mode) — there is no
 * GCS dependency. When the processor supplies a pre-resolved audio-only
 * proxy path it is preferred over the original file, with fallback to the
 * original if the proxy cannot be opened.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { StorageService } from '../../shared/services/storage.service';
import type {
  SpeakerTranscriptionResponse,
  SpeakerTranscribedWord,
} from '../types/executor-responses';

/**
 * Configuration for speaker transcription
 */
export interface SpeakerTranscriptionConfig {
  modelId?: string; // default: 'scribe_v2'
  languageCode?: string; // hint; auto-detected by the provider when omitted
  numSpeakers?: number; // optional speaker-count hint (Scribe supports up to 32)
  tagAudioEvents?: boolean; // default: false
}

const ELEVENLABS_STT_URL = 'https://api.elevenlabs.io/v1/speech-to-text';
const DEFAULT_MODEL_ID = 'scribe_v2';

/**
 * Raw ElevenLabs speech-to-text response (the subset we consume)
 */
interface ElevenLabsSttResponse {
  language_code?: string;
  language_probability?: number;
  text?: string;
  words?: Array<{
    text?: string;
    type?: string;
    start?: number;
    end?: number;
    speaker_id?: string;
  }>;
}

/**
 * Executor for ElevenLabs Scribe STT API calls
 */
@Injectable()
export class SpeakerTranscriptionExecutor {
  private readonly logger = new Logger(SpeakerTranscriptionExecutor.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly storageService: StorageService
  ) {}

  /**
   * Execute speaker-diarized transcription on a media file
   *
   * @param workspaceId - Workspace record ID
   * @param mediaId - Media record ID
   * @param fileRef - Storage path of the file to transcribe
   * @param config - Speaker transcription configuration
   * @param audioProxyPath - Local path to a pre-resolved audio-only proxy;
   *   preferred over fileRef when provided, with fallback to fileRef if it
   *   cannot be opened
   * @returns Normalized speaker transcription response
   */
  async execute(
    workspaceId: string,
    mediaId: string,
    fileRef: string,
    config: SpeakerTranscriptionConfig = {},
    audioProxyPath?: string
  ): Promise<SpeakerTranscriptionResponse> {
    const apiKey = this.configService.get<string>('elevenlabs.apiKey');
    if (!apiKey) {
      throw new Error(
        'ELEVENLABS_API_KEY is not configured; cannot run speaker transcription'
      );
    }

    this.logger.log(
      `Executing speaker transcription for media ${mediaId} (workspace ${workspaceId})`
    );

    // Hold a temp-dir lease for the whole resolve+upload window so a sibling
    // step (e.g. upload_to_gcs) finishing first can't delete the shared
    // per-media temp files while the provider fetch is still streaming them.
    return this.storageService.withTempLease(mediaId, async () => {
      try {
        // Prefer the audio-only proxy when the processor resolved one — it is
        // far smaller than the original container, so the upload to ElevenLabs
        // is faster and cheaper. Any problem opening it falls back to the
        // original file below.
        // File-backed Blobs: stream from disk on demand, no 2 GiB Buffer cap.
        let blob: Blob | undefined;
        let uploadName = '';
        if (audioProxyPath) {
          try {
            blob = (await fs.openAsBlob(audioProxyPath)) as unknown as Blob;
            uploadName = path.basename(audioProxyPath);
            this.logger.log(
              `Using audio proxy for media ${mediaId}: ${audioProxyPath}`
            );
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            this.logger.warn(
              `Failed to open audio proxy ${audioProxyPath} for media ${mediaId}, falling back to original file: ${message}`
            );
          }
        }

        if (!blob) {
          // Resolve local file path (downloads from S3 to temp if needed)
          const localPath = await this.storageService.resolveFilePath({
            storagePath: fileRef,
            recordId: mediaId,
          });
          blob = (await fs.openAsBlob(localPath)) as unknown as Blob;
          uploadName = path.basename(localPath);
        }

        const formData = new FormData();
        formData.append('file', blob, uploadName);
        formData.append('model_id', config.modelId || DEFAULT_MODEL_ID);
        // Diarization is the point of this step. It requires single-channel
        // processing — never combine with use_multi_channel.
        formData.append('diarize', 'true');
        formData.append('timestamps_granularity', 'word');
        formData.append(
          'tag_audio_events',
          String(config.tagAudioEvents ?? false)
        );
        if (config.languageCode) {
          formData.append('language_code', config.languageCode);
        }
        if (config.numSpeakers) {
          formData.append('num_speakers', String(config.numSpeakers));
        }

        this.logger.debug(
          `Speaker transcription request: ${JSON.stringify({
            modelId: config.modelId || DEFAULT_MODEL_ID,
            languageCode: config.languageCode,
            numSpeakers: config.numSpeakers,
            tagAudioEvents: config.tagAudioEvents ?? false,
          })}`
        );

        const response = await fetch(ELEVENLABS_STT_URL, {
          method: 'POST',
          headers: { 'xi-api-key': apiKey },
          body: formData,
        });

        if (!response.ok) {
          const body = await response.text().catch(() => '');
          throw new Error(
            `ElevenLabs STT request failed with status ${response.status}: ${body.slice(0, 500)}`
          );
        }

        const result = (await response.json()) as ElevenLabsSttResponse;

        const words: SpeakerTranscribedWord[] = (result.words ?? []).map(
          (word) => ({
            text: word.text ?? '',
            type: (word.type as SpeakerTranscribedWord['type']) ?? 'word',
            start: word.start ?? 0,
            end: word.end ?? 0,
            speakerId: word.speaker_id || undefined,
          })
        );

        const spokenWords = words.filter((w) => w.type === 'word');
        const speakerIds = new Set(
          spokenWords.map((w) => w.speakerId).filter(Boolean)
        );

        this.logger.log(
          `Speaker transcription completed: ${(result.text ?? '').length} characters, ` +
            `${spokenWords.length} words, ${speakerIds.size} speakers, ` +
            `language: ${result.language_code ?? 'unknown'}`
        );

        return {
          transcript: result.text ?? '',
          languageCode: result.language_code ?? config.languageCode ?? '',
          languageProbability: result.language_probability ?? 0,
          words,
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(`Speaker transcription failed: ${errorMessage}`);
        throw new Error(
          `Speaker transcription execution failed: ${errorMessage}`
        );
      } finally {
        // Clean up the temp downloads for this media — the audio proxy (any
        // backend) and the original (S3 mode); no-op when nothing was
        // downloaded. Runs on success AND failure so a stateless pod never
        // leaks disk; deferred automatically while a sibling step still holds
        // a temp lease (the last holder performs the deletion).
        await this.storageService.cleanupTemp(mediaId);
      }
    });
  }
}
