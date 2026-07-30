import { describe, it, expect } from 'vitest';
import type { ProbeOutput } from '@project/shared';
import { probeFacts } from '../asset-meta';

const videoProbe: ProbeOutput = {
  duration: 12.5,
  width: 1280,
  height: 720,
  displayWidth: 1280,
  displayHeight: 720,
  rotation: 0,
  codec: 'h264',
  fps: 29.97,
  bitrate: 2_000_000,
  format: 'mov,mp4,m4a,3gp,3g2,mj2',
  size: 3_125_000,
  audio: { codec: 'aac', channels: 2, sampleRate: 48000 },
};

describe('probeFacts', () => {
  it('carries the measured video and audio facts', () => {
    expect(probeFacts(videoProbe)).toEqual({
      duration: 12.5,
      width: 1280,
      height: 720,
      fps: 29.97,
      codec: 'h264',
      bitrate: 2_000_000,
      format: 'mov,mp4,m4a,3gp,3g2,mj2',
      size: 3_125_000,
      channels: 2,
      sampleRate: 48000,
    });
  });

  it('reports display dimensions for a rotated output', () => {
    expect(
      probeFacts({
        ...videoProbe,
        width: 1920,
        height: 1080,
        displayWidth: 1080,
        displayHeight: 1920,
        rotation: 90,
      })
    ).toMatchObject({ width: 1080, height: 1920 });
  });

  it('omits video fields for an audio-only output', () => {
    const facts = probeFacts({
      duration: 41.98,
      width: 0,
      height: 0,
      displayWidth: 0,
      displayHeight: 0,
      rotation: 0,
      codec: 'mp3',
      fps: 0,
      format: 'mp3',
      audio: { codec: 'mp3', channels: 1, sampleRate: 44100 },
    });

    expect(facts).toEqual({
      duration: 41.98,
      codec: 'mp3',
      format: 'mp3',
      channels: 1,
      sampleRate: 44100,
    });
    expect('width' in facts).toBe(false);
    expect('fps' in facts).toBe(false);
  });

  it('leaves out what ffprobe did not report rather than zero-filling', () => {
    const facts = probeFacts({
      duration: 0,
      width: 0,
      height: 0,
      codec: 'unknown',
      fps: 0,
      format: 'unknown',
    });

    expect(facts).toEqual({});
  });

  it('coerces a legacy string sample rate', () => {
    expect(
      probeFacts({
        ...videoProbe,
        audio: {
          codec: 'aac',
          channels: 2,
          sampleRate: '44100' as unknown as number,
        },
      })
    ).toMatchObject({ sampleRate: 44100 });
  });
});
