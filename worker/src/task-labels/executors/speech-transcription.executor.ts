/**
 * Speech Transcription Executor
 *
 * Executes Google Cloud Video Intelligence API calls for SPEECH_TRANSCRIPTION feature.
 * This is a pure strategy implementation with no database operations.
 */

import { Injectable, Logger } from '@nestjs/common';
import { GoogleCloudService } from '../../shared/services/google-cloud.service';
import type {
  SpeechTranscriptionResponse,
  TranscribedWord,
} from '../types/executor-responses';
import { protos } from '@google-cloud/video-intelligence';

/**
 * Configuration for speech transcription
 */
export interface SpeechTranscriptionConfig {
  languageCode?: string; // default: 'en-US'
  enableAutomaticPunctuation?: boolean; // default: true
  enableSpeakerDiarization?: boolean; // default: false
  diarizationSpeakerCount?: number; // required if enableSpeakerDiarization is true
  maxAlternatives?: number; // default: 1
}

/**
 * Executor for Speech Transcription API calls
 */
@Injectable()
export class SpeechTranscriptionExecutor {
  private readonly logger = new Logger(SpeechTranscriptionExecutor.name);

  constructor(private readonly googleCloudService: GoogleCloudService) {}

  /**
   * Execute speech transcription on a video file using Video Intelligence API
   *
   * @param gcsUri - GCS URI of the video file (gs://bucket/path)
   * @param config - Speech transcription configuration
   * @returns Normalized speech transcription response
   */
  async execute(
    workspaceId: string,
    mediaId: string,
    config: SpeechTranscriptionConfig = {}
  ): Promise<SpeechTranscriptionResponse> {
    this.logger.log(`Executing speech transcription for media ${mediaId}`);
    const gcsUri = this.googleCloudService.getTempGcsUri(workspaceId, mediaId);

    try {
      // Use the authenticated Video Intelligence client from GoogleCloudService
      const client = this.googleCloudService.getVideoIntelligenceClient();

      // Build speech transcription config
      const speechTranscriptionConfig: protos.google.cloud.videointelligence.v1.ISpeechTranscriptionConfig =
        {
          languageCode: config.languageCode || 'en-US',
          enableAutomaticPunctuation: config.enableAutomaticPunctuation ?? true,
          maxAlternatives: config.maxAlternatives || 1,
        };

      // Add speaker diarization if enabled
      if (config.enableSpeakerDiarization) {
        speechTranscriptionConfig.enableSpeakerDiarization = true;
        if (config.diarizationSpeakerCount) {
          speechTranscriptionConfig.diarizationSpeakerCount =
            config.diarizationSpeakerCount;
        }
      }

      // Build request
      const request = {
        inputUri: gcsUri,
        features: [
          protos.google.cloud.videointelligence.v1.Feature.SPEECH_TRANSCRIPTION,
        ],
        videoContext: {
          speechTranscriptionConfig: speechTranscriptionConfig,
        },
      };

      this.logger.debug(
        `Speech transcription request: ${JSON.stringify({
          gcsUri,
          languageCode: config.languageCode || 'en-US',
          enableAutomaticPunctuation: config.enableAutomaticPunctuation ?? true,
          enableSpeakerDiarization: config.enableSpeakerDiarization ?? false,
        })}`
      );

      // Execute API call
      const [operation] = await client.annotateVideo(request);
      this.logger.log(
        `Speech transcription operation started: ${operation.name}`
      );

      // Wait for operation to complete
      const [result] = await operation.promise();

      // Validate that we got a valid result
      if (!result) {
        const errorMsg =
          'Speech transcription operation completed but returned no result';
        this.logger.error(errorMsg);
        throw new Error(errorMsg);
      }

      // Validate annotation results exist
      if (!result.annotationResults || result.annotationResults.length === 0) {
        const errorMsg =
          'Speech transcription operation completed but returned no annotation results';
        this.logger.error(errorMsg);
        throw new Error(errorMsg);
      }

      const annotation = result.annotationResults[0];

      // Validate speech transcriptions exist
      if (
        !annotation.speechTranscriptions ||
        annotation.speechTranscriptions.length === 0
      ) {
        const errorMsg =
          'Speech transcription operation completed but returned no speech transcriptions';
        this.logger.error(errorMsg);
        throw new Error(errorMsg);
      }

      // Combine all transcriptions (usually there's one, but we handle multiple)
      let fullTranscript = '';
      let totalConfidence = 0;
      const allWords: TranscribedWord[] = [];

      for (const speechTranscription of annotation.speechTranscriptions) {
        if (
          speechTranscription.alternatives &&
          speechTranscription.alternatives.length > 0
        ) {
          const alternative = speechTranscription.alternatives[0];
          fullTranscript += alternative.transcript + ' ';
          totalConfidence += alternative.confidence || 0;

          // Process word-level timing
          if (alternative.words) {
            for (const word of alternative.words) {
              allWords.push({
                word: word.word || '',
                startTime: this.parseTimeOffset(word.startTime),
                endTime: this.parseTimeOffset(word.endTime),
                confidence: alternative.confidence || 0,
                speakerTag: word.speakerTag || undefined,
              });
            }
          }
        }
      }

      const avgConfidence =
        annotation.speechTranscriptions.length > 0
          ? totalConfidence / annotation.speechTranscriptions.length
          : 0;

      this.logger.log(
        `Speech transcription completed: ${fullTranscript.length} characters, ` +
          `${allWords.length} words, confidence: ${avgConfidence.toFixed(2)}`
      );

      return {
        transcript: fullTranscript.trim(),
        confidence: avgConfidence,
        words: allWords,
        languageCode: config.languageCode || 'en-US',
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Speech transcription failed: ${errorMessage}`);
      throw new Error(`Speech transcription execution failed: ${errorMessage}`);
    }
  }

  /**
   * Parse Google Cloud time offset to seconds
   */
  private parseTimeOffset(
    timeOffset: protos.google.protobuf.IDuration | null | undefined
  ): number {
    if (!timeOffset) return 0;

    const seconds = parseInt(String(timeOffset.seconds || '0'), 10);
    const nanos = parseInt(String(timeOffset.nanos || '0'), 10);

    return seconds + nanos / 1000000000;
  }
}
