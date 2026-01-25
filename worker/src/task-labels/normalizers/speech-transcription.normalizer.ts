import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { LabelType, ProcessingProvider } from '@project/shared';
import type {
  SpeechTranscriptionResponse,
  NormalizerInput,
  NormalizerOutput,
  LabelEntityData,
  LabelSpeechData,
  LabelTrackData,
  LabelMediaData,
} from '../types';

/**
 * Speech Transcription Normalizer
 *
 * Transforms GCVI Speech Transcription API responses into database entities:
 * - LabelEntity: Significant words/phrases from the transcript
 * - LabelSpeech: Detailed speech segments with timing and speaker info
 * - LabelMedia: Full transcript and word counts
 *
 * This normalizer handles:
 * - Full transcript text
 * - Word-level timing information
 * - Speech segment creation
 * - Significant word/phrase extraction
 */
@Injectable()
export class SpeechTranscriptionNormalizer {
  private readonly logger = new Logger(SpeechTranscriptionNormalizer.name);

  // Configuration for segment creation
  private readonly MAX_SEGMENT_DURATION = 30.0; // seconds
  private readonly MIN_WORD_CONFIDENCE = 0.7; // For significant word extraction
  private readonly MIN_WORD_LENGTH = 4; // Minimum characters for significant words

  /**
   * Normalize speech transcription response into database entities
   *
   * @param input Normalizer input with response and context
   * @returns Normalized entities ready for database insertion
   */
  async normalize(
    input: NormalizerInput<SpeechTranscriptionResponse>
  ): Promise<NormalizerOutput> {
    const {
      response,
      mediaId,
      workspaceRef,
      taskRef,
      version,
      processor: _processor,
      processorVersion,
    } = input;

    this.logger.debug(
      `Normalizing speech transcription response for media ${mediaId}: ${response.words.length} words`
    );

    const labelEntities: LabelEntityData[] = [];
    const labelSpeech: LabelSpeechData[] = [];
    const labelTracks: LabelTrackData[] = [];

    // Create speech segments (time-bounded chunks)
    const segments = this.createSpeechSegments(response.words);
    this.logger.debug(`Created ${segments.length} segments`);

    // Group segments by speaker to create tracks
    const speakerSegments = new Map<number, typeof segments>();
    for (const segment of segments) {
      const tag = segment.speakerTag ?? 0;
      let segmentsList = speakerSegments.get(tag);
      if (!segmentsList) {
        segmentsList = [];
        speakerSegments.set(tag, segmentsList);
      }
      segmentsList.push(segment);
    }

    // Process each speaker
    for (const [tag, utterances] of speakerSegments.entries()) {
      const trackId = tag.toString();

      // Generate entity for this speaker
      // Format: "Clip Speaker Y" or "Track Z"
      const speakerName = tag > 0 ? `Clip Speaker ${tag}` : `Track ${trackId}`;

      const entityHash = this.generateEntityHash(
        workspaceRef,
        LabelType.SPEECH,
        speakerName,
        ProcessingProvider.GOOGLE_SPEECH
      );

      labelEntities.push({
        WorkspaceRef: workspaceRef,
        labelType: LabelType.SPEECH,
        canonicalName: speakerName,
        provider: ProcessingProvider.GOOGLE_SPEECH,
        processor: processorVersion,
        entityHash,
        metadata: {
          speakerTag: tag,
          languageCode: response.languageCode,
        },
      });

      // Create a track for this speaker
      const trackHash = this.generateTrackHash(
        mediaId,
        trackId,
        ProcessingProvider.GOOGLE_SPEECH
      );

      const trackStart = Math.min(...utterances.map((u) => u.start));
      const trackEnd = Math.max(...utterances.map((u) => u.end));

      labelTracks.push({
        WorkspaceRef: workspaceRef,
        MediaRef: mediaId,
        TaskRef: taskRef,
        trackId,
        trackHash,
        start: trackStart,
        end: trackEnd,
        duration: trackEnd - trackStart,
        confidence:
          utterances.reduce((sum: number, u) => sum + u.confidence, 0) /
          utterances.length,
        provider: ProcessingProvider.GOOGLE_SPEECH,
        processor: processorVersion,
        version,
        trackData: {
          speakerTag: tag,
          utteranceCount: utterances.length,
        },
        keyframes: [], // Speech doesn't have spatial keyframes
      });

      // Create LabelSpeech records for each utterance
      for (const segment of utterances) {
        const speechHash = this.generateSpeechHash(
          mediaId,
          segment.start,
          segment.end,
          processorVersion
        );

        labelSpeech.push({
          WorkspaceRef: workspaceRef,
          MediaRef: mediaId,
          labelType: LabelType.SPEECH,
          transcript: segment.text,
          start: segment.start,
          end: segment.end,
          duration: segment.end - segment.start,
          confidence: segment.confidence,
          words: segment.words.map((w: string, idx: number) => ({
            word: w,
            startTime: segment.wordTimings[idx].start,
            endTime: segment.wordTimings[idx].end,
            confidence: segment.wordTimings[idx].confidence,
            speakerTag: segment.speakerTag,
          })),
          speakerTag: segment.speakerTag,
          languageCode: response.languageCode,
          speechHash,
          // Refs will be populated by the processor
        });
      }
    }

    // Create LabelMedia update with full transcript and counts
    const labelMediaUpdate: Partial<LabelMediaData> = {
      speechTranscriptionProcessedAt: new Date().toISOString(),
      speechTranscriptionProcessor: processorVersion,
      transcript: response.transcript,
      transcriptLength: response.transcript.length,
      wordCount: response.words.length,
      // Add processor to processors array
      processors: ['speech_transcription'],
    };

    this.logger.debug(
      `Normalized ${labelEntities.length} speakers/entities, ${labelTracks.length} tracks, ${labelSpeech.length} speech segments`
    );

    return {
      labelEntities,
      labelSpeech,
      labelTracks,
      labelMediaUpdate,
    };
  }

  /**
   * Create speech segments from words
   *
   * Groups words into time-bounded segments with maximum duration or speaker change.
   * Each segment represents a continuous speech chunk.
   *
   * @param words Array of transcribed words with timing
   * @returns Array of speech segments
   */
  private createSpeechSegments(
    words: Array<{
      word: string;
      startTime: number;
      endTime: number;
      confidence: number;
      speakerTag?: number;
    }>
  ): Array<{
    start: number;
    end: number;
    text: string;
    confidence: number;
    wordCount: number;
    words: string[];
    wordTimings: Array<{ start: number; end: number; confidence: number }>;
    speakerTag?: number;
  }> {
    if (words.length === 0) {
      return [];
    }

    const segments: Array<{
      start: number;
      end: number;
      text: string;
      confidence: number;
      wordCount: number;
      words: string[];
      wordTimings: Array<{ start: number; end: number; confidence: number }>;
      speakerTag?: number;
    }> = [];

    let currentSegment: {
      start: number;
      end: number;
      words: string[];
      confidences: number[];
      wordTimings: Array<{ start: number; end: number; confidence: number }>;
      speakerTag?: number;
    } = {
      start: words[0].startTime,
      end: words[0].endTime,
      words: [words[0].word],
      confidences: [words[0].confidence],
      wordTimings: [
        {
          start: words[0].startTime,
          end: words[0].endTime,
          confidence: words[0].confidence,
        },
      ],
      speakerTag: words[0].speakerTag,
    };

    for (let i = 1; i < words.length; i++) {
      const word = words[i];
      const segmentDuration = word.endTime - currentSegment.start;
      const speakerChanged = word.speakerTag !== currentSegment.speakerTag;

      // Check if we should start a new segment (duration or speaker change)
      if (segmentDuration > this.MAX_SEGMENT_DURATION || speakerChanged) {
        // Finalize current segment
        segments.push({
          start: currentSegment.start,
          end: currentSegment.end,
          text: currentSegment.words.join(' '),
          confidence:
            currentSegment.confidences.reduce((sum: number, c) => sum + c, 0) /
            currentSegment.confidences.length,
          wordCount: currentSegment.words.length,
          words: currentSegment.words,
          wordTimings: currentSegment.wordTimings,
          speakerTag: currentSegment.speakerTag,
        });

        // Start new segment
        currentSegment = {
          start: word.startTime,
          end: word.endTime,
          words: [word.word],
          confidences: [word.confidence],
          wordTimings: [
            {
              start: word.startTime,
              end: word.endTime,
              confidence: word.confidence,
            },
          ],
          speakerTag: word.speakerTag,
        };
      } else {
        // Add word to current segment
        currentSegment.end = word.endTime;
        currentSegment.words.push(word.word);
        currentSegment.confidences.push(word.confidence);
        currentSegment.wordTimings.push({
          start: word.startTime,
          end: word.endTime,
          confidence: word.confidence,
        });
      }
    }

    // Finalize last segment
    if (currentSegment.words.length > 0) {
      segments.push({
        start: currentSegment.start,
        end: currentSegment.end,
        text: currentSegment.words.join(' '),
        confidence:
          currentSegment.confidences.reduce((sum: number, c) => sum + c, 0) /
          currentSegment.confidences.length,
        wordCount: currentSegment.words.length,
        words: currentSegment.words,
        wordTimings: currentSegment.wordTimings,
        speakerTag: currentSegment.speakerTag,
      });
    }

    return segments;
  }

  /**
   * Generate track hash for deduplication
   */
  private generateTrackHash(
    mediaId: string,
    trackId: string,
    provider: ProcessingProvider
  ): string {
    const hashInput = `${mediaId}:${trackId}:${provider}`;
    return createHash('sha256').update(hashInput).digest('hex');
  }

  /**
   * Generate speech hash for deduplication
   */
  private generateSpeechHash(
    mediaId: string,
    start: number,
    end: number,
    processor: string
  ): string {
    const hashInput = `${mediaId}:${start.toFixed(1)}:${end.toFixed(1)}:${processor}:speech`;
    return createHash('sha256').update(hashInput).digest('hex');
  }

  /**
   * Generate entity hash for deduplication
   */
  private generateEntityHash(
    workspaceRef: string,
    labelType: LabelType,
    canonicalName: string,
    provider: ProcessingProvider
  ): string {
    const normalizedName = canonicalName.trim().toLowerCase();
    const hashInput = `${workspaceRef}:${labelType}:${normalizedName}:${provider}`;
    return createHash('sha256').update(hashInput).digest('hex');
  }
}
