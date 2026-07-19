import { describe, expect, it, vi } from 'vitest';
import { TaskMutator, asTaskRecordProvider } from '../task';
import { ProcessingProvider } from '../../enums';
import type { TypedPocketBase } from '../../types';
import type {
  DetectLabelsPayload,
  ProcessUploadPayload,
  RenderTimelinePayload,
} from '../../types/task-contracts';

function fakePb() {
  const create = vi.fn(async (data: object) => ({ id: 'task1', ...data }));
  const pb = {
    collection: (name: string) => {
      if (name !== 'Tasks') throw new Error(`unexpected collection: ${name}`);
      return { create };
    },
  } as unknown as TypedPocketBase;
  return { pb, create };
}

describe('asTaskRecordProvider', () => {
  it('passes through providers the Task record accepts', () => {
    expect(
      asTaskRecordProvider(ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE)
    ).toBe(ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE);
    expect(asTaskRecordProvider(ProcessingProvider.FFMPEG)).toBe(
      ProcessingProvider.FFMPEG
    );
  });

  it('drops payload-only providers and unknown values', () => {
    expect(asTaskRecordProvider(ProcessingProvider.ELEVENLABS)).toBeUndefined();
    expect(asTaskRecordProvider('something_else')).toBeUndefined();
    expect(asTaskRecordProvider(undefined)).toBeUndefined();
    expect(asTaskRecordProvider('')).toBeUndefined();
  });
});

describe('TaskMutator provider stamping', () => {
  it('createDetectLabelsTask stores the payload provider on the record', async () => {
    const { pb, create } = fakePb();
    const payload: DetectLabelsPayload = {
      mediaId: 'm1',
      fileRef: 'uploads/w1/u1/original.mp4',
      provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
      config: { confidenceThreshold: 0.5, detectLabels: true },
    };

    await new TaskMutator(pb).createDetectLabelsTask('w1', 'u1', 'm1', payload);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
      }),
      expect.anything()
    );
  });

  it('createProcessUploadTask defaults the provider to ffmpeg', async () => {
    const { pb, create } = fakePb();
    const payload: ProcessUploadPayload = {
      uploadId: 'up1',
      mediaId: 'm1',
    };

    await new TaskMutator(pb).createProcessUploadTask(
      'w1',
      'u1',
      'up1',
      payload
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ provider: ProcessingProvider.FFMPEG }),
      expect.anything()
    );
  });

  it('createRenderTimelineTask honors an explicit payload provider', async () => {
    const { pb, create } = fakePb();
    const payload: RenderTimelinePayload = {
      timelineId: 'tl1',
      version: 1,
      tracks: [],
      outputSettings: {
        format: 'mp4',
        resolution: '1080p',
      } as RenderTimelinePayload['outputSettings'],
      provider: ProcessingProvider.GOOGLE_TRANSCODER,
    };

    await new TaskMutator(pb).createRenderTimelineTask(
      'w1',
      'u1',
      'tl1',
      payload
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: ProcessingProvider.GOOGLE_TRANSCODER,
      }),
      expect.anything()
    );
  });
});
