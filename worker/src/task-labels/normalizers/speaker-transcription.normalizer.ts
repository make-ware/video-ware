import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { LabelType, ProcessingProvider } from '@project/shared';
import type {
  SpeakerTranscriptionResponse,
  SpeakerTranscribedWord,
  NormalizerInput,
  NormalizerOutput,
  LabelEntityData,
  LabelSpeakerData,
  LabelTrackData,
  LabelMediaData,
} from '../types';

/**
 * Speaker Transcription Normalizer
 *
 * Transforms diarized STT responses (ElevenLabs Scribe) into database
 * entities:
 * - LabelEntity: One per detected speaker ("Speaker 1", "Speaker 2", ...)
 * - LabelTrack: One per speaker spanning their utterances
 * - LabelSpeaker: One per continuous utterance, with word-precise timing
 * - LabelMedia: Full transcript, word and speaker counts
 *
 * Utterances are the editing unit for Q&A-style content: consecutive words
 * from the same speaker are grouped until the speaker changes (or a max
 * duration is hit), so the editor can see who says what, when.
 */
@Injectable()
export class SpeakerTranscriptionNormalizer {
  private readonly logger = new Logger(SpeakerTranscriptionNormalizer.name);

  // Utterances longer than this are split even without a speaker change
  private readonly MAX_UTTERANCE_DURATION = 30.0; // seconds

  // Speaker id assigned to words the provider left unattributed
  private readonly UNKNOWN_SPEAKER_ID = 'speaker_unknown';

  /**
   * Normalize speaker transcription response into database entities
   *
   * @param input Normalizer input with response and context
   * @returns Normalized entities ready for database insertion
   */
  async normalize(
    input: NormalizerInput<SpeakerTranscriptionResponse>
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

    // Only spoken words carry meaning for utterances; spacing tokens and
    // audio events are dropped (the raw response stays in the label cache).
    const spokenWords = response.words.filter((word) => word.type === 'word');

    this.logger.debug(
      `Normalizing speaker transcription response for media ${mediaId}: ` +
        `${spokenWords.length} words of ${response.words.length} tokens`
    );

    const labelEntities: LabelEntityData[] = [];
    const labelSpeakers: LabelSpeakerData[] = [];
    const labelTracks: LabelTrackData[] = [];

    // Confidence is provider language probability, clamped to [0, 1]
    const confidence = Math.min(
      Math.max(response.languageProbability ?? 0, 0),
      1
    );

    const utterances = this.createUtterances(spokenWords);
    this.logger.debug(`Created ${utterances.length} utterances`);

    // Group utterances by speaker to create entities and tracks
    const speakerUtterances = new Map<string, typeof utterances>();
    for (const utterance of utterances) {
      let utteranceList = speakerUtterances.get(utterance.speakerId);
      if (!utteranceList) {
        utteranceList = [];
        speakerUtterances.set(utterance.speakerId, utteranceList);
      }
      utteranceList.push(utterance);
    }

    // Process each speaker
    for (const [speakerId, speakerUtteranceList] of speakerUtterances) {
      const speakerName = this.speakerDisplayName(speakerId);

      const entityHash = this.generateEntityHash(
        workspaceRef,
        LabelType.SPEAKER,
        speakerName,
        ProcessingProvider.ELEVENLABS
      );

      labelEntities.push({
        WorkspaceRef: workspaceRef,
        labelType: LabelType.SPEAKER,
        canonicalName: speakerName,
        provider: ProcessingProvider.ELEVENLABS,
        processor: processorVersion,
        entityHash,
        metadata: {
          speakerId,
          languageCode: response.languageCode,
        },
      });

      // Create a track for this speaker spanning all their utterances
      const trackHash = this.generateTrackHash(
        mediaId,
        speakerId,
        ProcessingProvider.ELEVENLABS
      );

      const trackStart = Math.min(...speakerUtteranceList.map((u) => u.start));
      const trackEnd = Math.max(...speakerUtteranceList.map((u) => u.end));

      labelTracks.push({
        WorkspaceRef: workspaceRef,
        MediaRef: mediaId,
        TaskRef: taskRef,
        trackId: speakerId,
        trackHash,
        start: trackStart,
        end: trackEnd,
        duration: trackEnd - trackStart,
        confidence,
        provider: ProcessingProvider.ELEVENLABS,
        processor: processorVersion,
        version,
        trackData: {
          speakerId,
          utteranceCount: speakerUtteranceList.length,
        },
        keyframes: [], // Speech doesn't have spatial keyframes
      });

      // Create LabelSpeaker records for each utterance
      for (const utterance of speakerUtteranceList) {
        const speakerHash = this.generateSpeakerHash(
          mediaId,
          utterance.start,
          utterance.end,
          speakerId,
          processorVersion
        );

        labelSpeakers.push({
          WorkspaceRef: workspaceRef,
          MediaRef: mediaId,
          transcript: utterance.text,
          start: utterance.start,
          end: utterance.end,
          duration: utterance.end - utterance.start,
          confidence,
          speakerId,
          languageCode: response.languageCode || undefined,
          words: utterance.words.map((word) => ({
            text: word.text,
            start: word.start,
            end: word.end,
            speakerId: word.speakerId,
          })),
          speakerHash,
          // Refs will be populated by the processor
        });
      }
    }

    // Create LabelMedia update with full transcript and counts
    const labelMediaUpdate: Partial<LabelMediaData> = {
      speakerTranscriptionProcessedAt: new Date().toISOString(),
      speakerTranscriptionProcessor: processorVersion,
      transcript: response.transcript,
      transcriptLength: response.transcript.length,
      wordCount: spokenWords.length,
      speakerCount: speakerUtterances.size,
      // Add processor to processors array
      processors: ['speaker_transcription'],
    };

    this.logger.debug(
      `Normalized ${labelEntities.length} speakers, ${labelTracks.length} tracks, ` +
        `${labelSpeakers.length} utterances`
    );

    return {
      labelEntities,
      labelSpeakers,
      labelTracks,
      labelMediaUpdate,
    };
  }

  /**
   * Group spoken words into utterances
   *
   * A new utterance starts when the speaker changes or the current one
   * exceeds MAX_UTTERANCE_DURATION.
   *
   * @param words Spoken words (type === 'word') with timing and speaker ids
   * @returns Array of utterances
   */
  private createUtterances(words: SpeakerTranscribedWord[]): Array<{
    start: number;
    end: number;
    text: string;
    speakerId: string;
    words: SpeakerTranscribedWord[];
  }> {
    if (words.length === 0) {
      return [];
    }

    const utterances: Array<{
      start: number;
      end: number;
      text: string;
      speakerId: string;
      words: SpeakerTranscribedWord[];
    }> = [];

    let currentWords: SpeakerTranscribedWord[] = [words[0]];
    let currentSpeakerId = words[0].speakerId ?? this.UNKNOWN_SPEAKER_ID;

    const finalize = () => {
      const start = currentWords[0].start;
      const end = currentWords[currentWords.length - 1].end;
      utterances.push({
        start,
        end,
        text: currentWords.map((w) => w.text).join(' '),
        speakerId: currentSpeakerId,
        words: currentWords,
      });
    };

    for (let i = 1; i < words.length; i++) {
      const word = words[i];
      const speakerId = word.speakerId ?? this.UNKNOWN_SPEAKER_ID;
      const utteranceDuration = word.end - currentWords[0].start;

      if (
        speakerId !== currentSpeakerId ||
        utteranceDuration > this.MAX_UTTERANCE_DURATION
      ) {
        finalize();
        currentWords = [word];
        currentSpeakerId = speakerId;
      } else {
        currentWords.push(word);
      }
    }

    finalize();

    return utterances;
  }

  /**
   * Human-readable name for a provider speaker id.
   * "speaker_0" -> "Speaker 1"; unrecognized ids pass through as-is.
   */
  private speakerDisplayName(speakerId: string): string {
    const match = /^speaker_(\d+)$/.exec(speakerId);
    if (match) {
      return `Speaker ${parseInt(match[1], 10) + 1}`;
    }
    return speakerId;
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
   * Generate speaker utterance hash for deduplication
   */
  private generateSpeakerHash(
    mediaId: string,
    start: number,
    end: number,
    speakerId: string,
    processor: string
  ): string {
    const hashInput = `${mediaId}:${start.toFixed(2)}:${end.toFixed(2)}:${speakerId}:${processor}:speaker`;
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
