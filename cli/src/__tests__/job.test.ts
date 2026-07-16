import { describe, expect, it, vi } from 'vitest';
import { MediaType, TaskType, type Media } from '@project/shared';
import {
  createLabelJobTask,
  createTranscodeJobTask,
  defaultTranscodeAssets,
  labelDetectionConfig,
  parseLabelJobTypes,
  parseTranscodeAssets,
  resolveJobSource,
  transcodePayload,
} from '../lib/job.js';
import { fakePb, type Stub } from './fake-pb.js';

const notFound = () => Object.assign(new Error('not found'), { status: 404 });

const upload = {
  id: 'u1',
  name: 'clip.mp4',
  externalPath: 'ws1/originals/clip.mp4',
  UserRef: 'uploader1',
};

const media = {
  id: 'm1',
  WorkspaceRef: 'ws1',
  UploadRef: 'u1',
  mediaType: MediaType.VIDEO,
  expand: { UploadRef: upload },
};

/** Media collection stub returning one record (or 404) from getOne. */
function mediaStub(record: unknown): Stub {
  return {
    getOne: vi.fn(async () => {
      if (record) return record;
      throw notFound();
    }),
  };
}

/** Tasks collection stub echoing the created record with an id. */
function tasksStub(): Stub {
  return {
    create: vi.fn(async (data: Record<string, unknown>) => ({
      ...data,
      id: 'task1',
    })),
  };
}

describe('parseLabelJobTypes', () => {
  it('parses and dedupes a comma-separated list', () => {
    expect(parseLabelJobTypes('speech, speaker,speech')).toEqual([
      'speech',
      'speaker',
    ]);
  });

  it('rejects unknown types', () => {
    expect(() => parseLabelJobTypes('speech,robot')).toThrow(
      /invalid label type/i
    );
  });

  it('rejects an empty list', () => {
    expect(() => parseLabelJobTypes(' , ')).toThrow(
      /expected comma-separated/i
    );
  });
});

describe('labelDetectionConfig', () => {
  it('requests every detector by default', () => {
    expect(labelDetectionConfig()).toEqual({
      confidenceThreshold: 0.5,
      detectObjects: true,
      detectLabels: true,
      detectFaces: true,
      detectPersons: true,
      detectSpeech: true,
      detectSpeakers: true,
    });
  });

  it('sets unrequested types to explicit false for a subset', () => {
    expect(labelDetectionConfig(['speech', 'object'], 0.7)).toEqual({
      confidenceThreshold: 0.7,
      detectObjects: true,
      detectLabels: false,
      detectFaces: false,
      detectPersons: false,
      detectSpeech: true,
      detectSpeakers: false,
    });
  });
});

describe('resolveJobSource', () => {
  it('fails when the media does not exist', async () => {
    const pb = fakePb({ Media: mediaStub(null) });
    await expect(resolveJobSource(pb, 'missing')).rejects.toThrow(
      /media not found/i
    );
  });

  it('fails when the upload has no stored original', async () => {
    const pb = fakePb({
      Media: mediaStub({
        ...media,
        expand: { UploadRef: { ...upload, externalPath: '' } },
      }),
    });
    await expect(resolveJobSource(pb, 'm1')).rejects.toThrow(
      /no stored original/i
    );
  });

  it('resolves the upload and source path', async () => {
    const pb = fakePb({ Media: mediaStub(media) });
    await expect(resolveJobSource(pb, 'm1')).resolves.toMatchObject({
      upload: { id: 'u1' },
      sourcePath: 'ws1/originals/clip.mp4',
    });
  });
});

describe('createLabelJobTask', () => {
  it('queues a detect_labels task for the media', async () => {
    const tasks = tasksStub();
    const pb = fakePb({ Media: mediaStub(media), Tasks: tasks });

    const { task, types } = await createLabelJobTask(pb, {
      mediaId: 'm1',
      types: ['speech'],
    });

    expect(task.id).toBe('task1');
    expect(types).toEqual(['speech']);
    expect(tasks.create).toHaveBeenCalledTimes(1);
    expect(tasks.create.mock.calls[0][0]).toMatchObject({
      type: TaskType.DETECT_LABELS,
      sourceType: 'Media',
      sourceId: 'm1',
      WorkspaceRef: 'ws1',
      UserRef: 'user1',
      payload: {
        mediaId: 'm1',
        fileRef: 'ws1/originals/clip.mp4',
        config: { detectSpeech: true, detectObjects: false },
      },
    });
  });

  it('defaults to all label types', async () => {
    const pb = fakePb({ Media: mediaStub(media), Tasks: tasksStub() });
    const { types } = await createLabelJobTask(pb, { mediaId: 'm1' });
    expect(types).toEqual([
      'object',
      'shot',
      'face',
      'person',
      'speech',
      'speaker',
    ]);
  });

  it('rejects image media', async () => {
    const pb = fakePb({
      Media: mediaStub({ ...media, mediaType: MediaType.IMAGE }),
      Tasks: tasksStub(),
    });
    await expect(createLabelJobTask(pb, { mediaId: 'm1' })).rejects.toThrow(
      /image/i
    );
  });
});

describe('defaultTranscodeAssets', () => {
  it('regenerates everything for video', () => {
    expect(defaultTranscodeAssets(MediaType.VIDEO)).toEqual([
      'thumbnail',
      'sprite',
      'filmstrip',
      'proxy',
      'audio',
    ]);
  });

  it('only extracts audio for audio media', () => {
    expect(defaultTranscodeAssets(MediaType.AUDIO)).toEqual(['audio']);
  });

  it('only stills for image media', () => {
    expect(defaultTranscodeAssets(MediaType.IMAGE)).toEqual([
      'thumbnail',
      'sprite',
    ]);
  });
});

describe('parseTranscodeAssets', () => {
  it('parses and dedupes a comma-separated list', () => {
    expect(parseTranscodeAssets('proxy, sprite,proxy')).toEqual([
      'proxy',
      'sprite',
    ]);
  });

  it('rejects unknown assets', () => {
    expect(() => parseTranscodeAssets('proxy,poster')).toThrow(
      /invalid asset/i
    );
  });
});

describe('transcodePayload', () => {
  it('includes only the requested asset configs', () => {
    const payload = transcodePayload(media as unknown as Media, 'u1', [
      'proxy',
      'audio',
    ]);
    expect(payload).toEqual({
      uploadId: 'u1',
      mediaId: 'm1',
      provider: 'ffmpeg',
      transcode: { enabled: true, codec: 'h264', resolution: '720p' },
      audio: { enabled: true, bitrate: '128k' },
    });
  });

  it('uses a single-tile sprite for images', () => {
    const payload = transcodePayload(
      { ...media, mediaType: MediaType.IMAGE } as unknown as Media,
      'u1',
      ['sprite']
    );
    expect(payload.sprite).toMatchObject({ cols: 1, rows: 1 });
  });
});

describe('createTranscodeJobTask', () => {
  it('queues a process_upload task keyed to the upload', async () => {
    const tasks = tasksStub();
    const pb = fakePb({ Media: mediaStub(media), Tasks: tasks });

    const { task, assets } = await createTranscodeJobTask(pb, {
      mediaId: 'm1',
      assets: ['proxy'],
    });

    expect(task.id).toBe('task1');
    expect(assets).toEqual(['proxy']);
    expect(tasks.create.mock.calls[0][0]).toMatchObject({
      type: TaskType.PROCESS_UPLOAD,
      sourceType: 'upload',
      sourceId: 'u1',
      WorkspaceRef: 'ws1',
      UserRef: 'user1',
      payload: {
        uploadId: 'u1',
        mediaId: 'm1',
        transcode: { enabled: true, codec: 'h264', resolution: '720p' },
      },
    });
  });

  it('defaults assets by media type', async () => {
    const pb = fakePb({
      Media: mediaStub({
        ...media,
        mediaType: MediaType.AUDIO,
      }),
      Tasks: tasksStub(),
    });
    const { assets } = await createTranscodeJobTask(pb, { mediaId: 'm1' });
    expect(assets).toEqual(['audio']);
  });
});
