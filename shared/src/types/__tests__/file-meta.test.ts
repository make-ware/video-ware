import { describe, it, expect } from 'vitest';
import { FileMetaSchema } from '../metadata';

/**
 * `meta` is written by the worker and validated by the File mutator, so any
 * field the schema does not declare is silently dropped on the way in. These
 * tests pin the shapes each producer actually writes.
 */
describe('FileMetaSchema', () => {
  it('keeps the sprite/filmstrip geometry a producer records', () => {
    const filmstrip = {
      mimeType: 'image/jpeg',
      filmstripConfig: {
        cols: 100,
        rows: 1,
        tileWidth: 320,
        tileHeight: 570,
        segmentIndex: 2,
        startTime: 200,
        fps: 1,
      },
      width: 32000,
      height: 570,
    };

    expect(FileMetaSchema.parse(filmstrip)).toEqual(filmstrip);
  });

  it('keeps a probed proxy/render fact set', () => {
    const proxy = {
      mimeType: 'video/mp4',
      duration: 61.4,
      width: 406,
      height: 720,
      fps: 30,
      codec: 'h264',
      bitrate: 2_000_000,
      format: 'mov,mp4,m4a,3gp,3g2,mj2',
      size: 15_350_000,
      channels: 2,
      sampleRate: 48000,
    };

    expect(FileMetaSchema.parse(proxy)).toEqual(proxy);
  });

  it('keeps render settings alongside the measured facts', () => {
    const render = {
      mimeType: 'video/mp4',
      renderSettings: {
        resolution: '1920x1080',
        codec: 'h264',
        format: 'mp4',
        fps: 30,
      },
      width: 1920,
      height: 1080,
      duration: 12,
    };

    expect(FileMetaSchema.parse(render)).toEqual(render);
  });

  it('keeps an audio-only fact set', () => {
    const audio = {
      mimeType: 'audio/mpeg',
      duration: 41.98,
      codec: 'mp3',
      format: 'mp3',
      bitrate: 128000,
      size: 671680,
      channels: 2,
      sampleRate: 48000,
    };

    expect(FileMetaSchema.parse(audio)).toEqual(audio);
  });

  it('accepts a bare mime type (thumbnails written before dims were stored)', () => {
    expect(FileMetaSchema.parse({ mimeType: 'image/jpeg' })).toEqual({
      mimeType: 'image/jpeg',
    });
  });
});
