import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import type { Job } from 'bullmq';
import { LabelType, ProcessingProvider } from '@project/shared';
import { SpeakerTranscriptionStepProcessor } from '../speaker-transcription-step.processor';
import type { StepJobData } from '../../../queue/types/job.types';
import type { SpeakerTranscriptionStepInput } from '../../types/step-inputs';

// Mock Logger
vi.mock('@nestjs/common', async () => {
  const actual = await vi.importActual('@nestjs/common');
  const { MockLogger } = await import('@/__mocks__/logger');
  return {
    ...actual,
    Logger: MockLogger,
  };
});

/**
 * The write phase of SPEAKER_TRANSCRIPTION: a speaker is only identifiable in
 * the UI if its LabelTrack row exists (the track carries the Entity link), and
 * re-running the labels task is the documented repair path for media whose
 * tracks were never written.
 */
describe('SpeakerTranscriptionStepProcessor - persisting tracks and utterances', () => {
  let processor: SpeakerTranscriptionStepProcessor;
  let labelEntityService: any;
  let normalizer: any;
  let pocketBaseService: any;
  let trackMutator: any;
  let speakerMutator: any;

  const input: SpeakerTranscriptionStepInput = {
    type: 'speaker_transcription',
    mediaId: 'media-1',
    workspaceRef: 'ws-1',
    taskRef: 'task-1',
    version: 1,
    fileRef: 'uploads/ws-1/up-1/audio.mp3',
    config: {},
  };

  /** Three diarized speakers, one utterance each — the shape from the normalizer. */
  const normalized = (speakerIds: string[]) => ({
    labelEntities: speakerIds.map((speakerId, i) => ({
      WorkspaceRef: 'ws-1',
      labelType: LabelType.SPEAKER,
      canonicalName: `Speaker ${i + 1}`,
      provider: ProcessingProvider.ELEVENLABS,
      processor: 'speaker-transcription:1.0.0',
      entityHash: `entity-hash-${speakerId}`,
      metadata: { speakerId },
    })),
    labelTracks: speakerIds.map((speakerId) => ({
      WorkspaceRef: 'ws-1',
      MediaRef: 'media-1',
      trackId: speakerId,
      trackHash: `track-hash-${speakerId}`,
      start: 0,
      end: 1,
      duration: 1,
      confidence: 1,
      provider: ProcessingProvider.ELEVENLABS,
      processor: 'speaker-transcription:1.0.0',
      version: 1,
      trackData: { speakerId, utteranceCount: 1 },
      keyframes: [],
    })),
    labelSpeakers: speakerIds.map((speakerId) => ({
      WorkspaceRef: 'ws-1',
      MediaRef: 'media-1',
      transcript: 'hello',
      start: 0,
      end: 1,
      duration: 1,
      confidence: 1,
      speakerId,
      words: [],
      speakerHash: `speaker-hash-${speakerId}`,
    })),
    labelMediaUpdate: {},
  });

  const emptyList = {
    items: [],
    page: 1,
    perPage: 1,
    totalItems: 0,
    totalPages: 0,
  };

  beforeEach(() => {
    // No audio proxy in these fixtures, so keep the readiness wait short: the
    // step proceeds against the original upload once the window closes.
    process.env.SPEAKER_TRANSCRIPTION_AUDIO_WAIT_MS = '10';
    process.env.SPEAKER_TRANSCRIPTION_AUDIO_POLL_MS = '1';

    trackMutator = {
      getList: vi.fn().mockResolvedValue(emptyList),
      create: vi
        .fn()
        .mockImplementation(async (track: { trackId: string }) => ({
          id: `track-rec-${track.trackId}`,
        })),
      update: vi.fn().mockResolvedValue({}),
    };
    speakerMutator = {
      getList: vi.fn().mockResolvedValue(emptyList),
      create: vi
        .fn()
        .mockImplementation(async (utterance: { speakerId: string }) => ({
          id: `speaker-rec-${utterance.speakerId}`,
        })),
      update: vi.fn().mockResolvedValue({}),
    };

    labelEntityService = {
      getOrCreateLabelEntity: vi
        .fn()
        .mockImplementation(
          async (
            _ws: string,
            _type: string,
            _name: string,
            _provider: string,
            _processor: string,
            metadata: { speakerId?: string }
          ) => `entity-rec-${metadata?.speakerId}`
        ),
      clearCache: vi.fn(),
    };
    normalizer = {
      normalize: vi
        .fn()
        .mockResolvedValue(normalized(['speaker_0', 'speaker_1', 'speaker_2'])),
    };
    pocketBaseService = {
      getMedia: vi
        .fn()
        .mockResolvedValue({ id: 'media-1', duration: 10, hasAudio: true }),
      getFile: vi.fn().mockResolvedValue(null),
      labelTrackMutator: trackMutator,
      labelSpeakerMutator: speakerMutator,
    };

    processor = new SpeakerTranscriptionStepProcessor(
      {
        getCachedLabels: vi.fn().mockResolvedValue(null),
        isCacheValid: vi.fn().mockReturnValue(false),
        storeLabelCache: vi.fn().mockResolvedValue(undefined),
      } as any,
      labelEntityService,
      {
        execute: vi.fn().mockResolvedValue({
          transcript: 'hello',
          languageCode: 'eng',
          languageProbability: 1,
          words: [],
        }),
      } as any,
      normalizer,
      pocketBaseService,
      {
        createTempDir: vi.fn(),
        withTempLease: vi
          .fn()
          .mockImplementation((_id: string, fn: () => Promise<unknown>) =>
            fn()
          ),
      } as any
    );
  });

  afterEach(() => {
    delete process.env.SPEAKER_TRANSCRIPTION_AUDIO_WAIT_MS;
    delete process.env.SPEAKER_TRANSCRIPTION_AUDIO_POLL_MS;
    vi.clearAllMocks();
  });

  const runProcess = () => processor.process(input, {} as Job<StepJobData>);

  it('links every utterance to its own speaker track', async () => {
    const result = await runProcess();

    expect(result.counts.labelTrackCount).toBe(3);
    for (const speakerId of ['speaker_0', 'speaker_1', 'speaker_2']) {
      expect(speakerMutator.create).toHaveBeenCalledWith(
        expect.objectContaining({
          speakerId,
          LabelTrackRef: `track-rec-${speakerId}`,
          LabelEntityRef: `entity-rec-${speakerId}`,
        })
      );
    }
  });

  it('never maps an utterance onto another speaker track when one track fails', async () => {
    // The first track write fails. Positional id mapping used to shift every
    // later speaker onto the wrong track — speaker_1's words attributed to
    // speaker_2 — which is worse than a missing link.
    trackMutator.create.mockImplementation(
      async (track: { trackId: string }) => {
        if (track.trackId === 'speaker_0') {
          throw new Error('boom');
        }
        return { id: `track-rec-${track.trackId}` };
      }
    );

    await expect(runProcess()).rejects.toThrow(/persisted incompletely/);

    expect(speakerMutator.create).toHaveBeenCalledWith(
      expect.objectContaining({
        speakerId: 'speaker_1',
        LabelTrackRef: 'track-rec-speaker_1',
      })
    );
    expect(speakerMutator.create).toHaveBeenCalledWith(
      expect.objectContaining({
        speakerId: 'speaker_0',
        LabelTrackRef: undefined,
      })
    );
  });

  it('fails the step when a track could not be written', async () => {
    trackMutator.create.mockRejectedValue(new Error('boom'));

    await expect(runProcess()).rejects.toThrow(/persisted incompletely/);
    // Utterances are still written first so the transcript is not lost.
    expect(speakerMutator.create).toHaveBeenCalledTimes(3);
  });

  it('recovers a track lost to a concurrent run via the unique constraint', async () => {
    trackMutator.create.mockRejectedValue(
      Object.assign(new Error('Failed to create record.'), {
        response: { data: { trackHash: { code: 'validation_not_unique' } } },
      })
    );
    trackMutator.getList
      .mockResolvedValueOnce(emptyList)
      .mockResolvedValueOnce({
        ...emptyList,
        items: [
          { id: 'track-rec-speaker_0', LabelEntityRef: 'entity-rec-speaker_0' },
        ],
      })
      .mockResolvedValue({
        ...emptyList,
        items: [{ id: 'track-rec-other', LabelEntityRef: 'entity-rec-other' }],
      });

    const result = await runProcess();

    expect(result.success).toBe(true);
    expect(result.counts.labelTrackCount).toBe(3);
  });

  it('re-links utterances left unlinked by an earlier partial run', async () => {
    // The repair path: tracks now exist, but the utterances from the run that
    // failed to write them still carry no LabelTrackRef.
    speakerMutator.getList.mockImplementation(
      async (_page: number, _perPage: number, filter: string) => {
        const speakerId = /speaker-hash-(\S+?)"/.exec(filter)?.[1];
        return {
          ...emptyList,
          items: [
            {
              id: `speaker-rec-${speakerId}`,
              LabelTrackRef: '',
              LabelEntityRef: '',
            },
          ],
        };
      }
    );

    const result = await runProcess();

    expect(result.success).toBe(true);
    expect(speakerMutator.create).not.toHaveBeenCalled();
    expect(speakerMutator.update).toHaveBeenCalledWith(
      'speaker-rec-speaker_1',
      {
        LabelTrackRef: 'track-rec-speaker_1',
        LabelEntityRef: 'entity-rec-speaker_1',
      }
    );
  });

  it('refreshes an existing track cluster link without touching the manual EntityRef', async () => {
    trackMutator.getList.mockImplementation(
      async (_page: number, _perPage: number, filter: string) => {
        const speakerId = /track-hash-(\S+?)"/.exec(filter)?.[1];
        return {
          ...emptyList,
          items: [
            {
              id: `track-rec-${speakerId}`,
              LabelEntityRef: '',
              EntityRef: 'entity-erik',
            },
          ],
        };
      }
    );

    await runProcess();

    expect(trackMutator.create).not.toHaveBeenCalled();
    expect(trackMutator.update).toHaveBeenCalledWith('track-rec-speaker_0', {
      LabelEntityRef: 'entity-rec-speaker_0',
    });
    for (const call of trackMutator.update.mock.calls) {
      expect(call[1]).not.toHaveProperty('EntityRef');
    }
  });
});
