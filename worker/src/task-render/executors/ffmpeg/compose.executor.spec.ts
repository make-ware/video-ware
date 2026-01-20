import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FFmpegComposeExecutor } from './compose.executor';
import { FFmpegService } from '../../../shared/services/ffmpeg.service';
import type { TimelineTrack } from '@project/shared';

describe('FFmpegComposeExecutor', () => {
  let executor: FFmpegComposeExecutor;
  let ffmpegService: FFmpegService;

  beforeEach(async () => {
    // Manually create mock object
    const mockFFmpegService = {
      executeWithProgress: vi.fn(),
      probe: vi.fn().mockResolvedValue({
        format: {
          duration: '10.0',
          bit_rate: '1000',
          size: '1000',
          format_name: 'mp4',
        },
        streams: [
          {
            codec_type: 'video',
            width: 1920,
            height: 1080,
            codec_name: 'h264',
            r_frame_rate: '30/1',
          },
        ],
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FFmpegComposeExecutor,
        {
          provide: FFmpegService,
          useValue: mockFFmpegService,
        },
      ],
    }).compile();

    executor = module.get<FFmpegComposeExecutor>(FFmpegComposeExecutor);
    ffmpegService = module.get<FFmpegService>(FFmpegService);
  });

  it('should be defined', () => {
    expect(executor).toBeDefined();
    expect(ffmpegService).toBeDefined();
    // Check if service is injected
    // With private property, we can't check directly easily in TS without casting, but the fact that execute throws suggests it is undefined.
    // But module.get returns the instance which should have dependencies injected.
    // The issue is likely that 'private readonly' property is not being populated?
    // This is standard NestJS.
    // Maybe the mock needs to be a class instance?
  });

  it('should build correct FFmpeg command for single video track', async () => {
    const tracks: TimelineTrack[] = [
      {
        id: 'track1',
        type: 'video',
        layer: 0,
        segments: [
          {
            id: 'seg1',
            assetId: 'asset1',
            type: 'video',
            time: { start: 0, duration: 5, sourceStart: 0 },
          },
          {
            id: 'seg2',
            assetId: 'asset2',
            type: 'video',
            time: { start: 5, duration: 5, sourceStart: 0 },
          },
        ],
      },
    ];

    const clipMediaMap = {
      asset1: { media: { id: 'asset1' }, filePath: '/tmp/1.mp4' } as any,
      asset2: { media: { id: 'asset2' }, filePath: '/tmp/2.mp4' } as any,
    };

    const outputSettings = {
      codec: 'libx264',
      format: 'mp4',
      resolution: '1920x1080',
    };

    await executor.execute(
      tracks,
      clipMediaMap,
      '/tmp/output.mp4',
      outputSettings
    );

    const executeSpy = vi.spyOn(ffmpegService, 'executeWithProgress');
    const args = executeSpy.mock.calls[0][0] as string[];

    // Verify inputs
    expect(args).toContain('/tmp/1.mp4');
    expect(args).toContain('/tmp/2.mp4');

    // Verify filter complex
    const filterComplexIndex = args.indexOf('-filter_complex');
    expect(filterComplexIndex).toBeGreaterThan(-1);
    const filterComplex = args[filterComplexIndex + 1];

    expect(filterComplex).toContain('color=c=black');
    expect(filterComplex).toContain("overlay=x=0:y=0:enable='between(t,0,5)'");
    expect(filterComplex).toContain("overlay=x=0:y=0:enable='between(t,5,10)'");
  });

  it('should handle PIP overlay', async () => {
    const tracks: TimelineTrack[] = [
      {
        id: 'track1',
        type: 'video',
        layer: 0,
        segments: [
          {
            id: 'seg1',
            assetId: 'asset1',
            type: 'video',
            time: { start: 0, duration: 10, sourceStart: 0 },
          },
        ],
      },
      {
        id: 'track2',
        type: 'video',
        layer: 1,
        segments: [
          {
            id: 'seg2',
            assetId: 'asset2',
            type: 'video',
            time: { start: 2, duration: 5, sourceStart: 0 },
            video: { x: 100, y: 100, width: 320, height: 180 },
          },
        ],
      },
    ];

    const clipMediaMap = {
      asset1: { media: { id: 'asset1' }, filePath: '/tmp/bg.mp4' } as any,
      asset2: { media: { id: 'asset2' }, filePath: '/tmp/pip.mp4' } as any,
    };

    const outputSettings = {
      codec: 'libx264',
      format: 'mp4',
      resolution: '1920x1080',
    };

    await executor.execute(
      tracks,
      clipMediaMap,
      '/tmp/output.mp4',
      outputSettings
    );

    const executeSpy = vi.spyOn(ffmpegService, 'executeWithProgress');
    const args = executeSpy.mock.calls[0][0] as string[];
    const filterComplex = args[args.indexOf('-filter_complex') + 1];

    // Check for PIP scaling and overlay
    expect(filterComplex).toContain('scale=320:180');
    expect(filterComplex).toContain('overlay=x=100:y=100');
    expect(filterComplex).toContain("enable='between(t,2,7)'");
  });

  it('should handle text overlay', async () => {
    const tracks: TimelineTrack[] = [
      {
        id: 'track1',
        type: 'video',
        layer: 0,
        segments: [
          {
            id: 'seg1',
            assetId: 'asset1',
            type: 'video',
            time: { start: 0, duration: 5, sourceStart: 0 },
          },
        ],
      },
      {
        id: 'track2',
        type: 'text',
        layer: 1,
        segments: [
          {
            id: 'txt1',
            type: 'text',
            time: { start: 1, duration: 2, sourceStart: 0 },
            text: {
              content: 'Hello World',
              fontSize: 50,
              color: '#FFFFFF',
              x: 10,
              y: 10,
            },
          },
        ],
      },
    ];

    const clipMediaMap = {
      asset1: { media: { id: 'asset1' }, filePath: '/tmp/bg.mp4' } as any,
    };

    const outputSettings = {
      codec: 'libx264',
      format: 'mp4',
      resolution: '1920x1080',
    };

    await executor.execute(
      tracks,
      clipMediaMap,
      '/tmp/output.mp4',
      outputSettings
    );

    const executeSpy = vi.spyOn(ffmpegService, 'executeWithProgress');
    const args = executeSpy.mock.calls[0][0] as string[];
    const filterComplex = args[args.indexOf('-filter_complex') + 1];

    expect(filterComplex).toContain("drawtext=text='Hello World'");
    expect(filterComplex).toContain('fontsize=50');
    // Color might be converted
    expect(filterComplex).toContain('fontcolor=0xFFFFFFFF'); // #FFFFFF -> 0xFFFFFFFF
    expect(filterComplex).toContain("enable='between(t,1,3)'");
  });

  it('should skip audio filters for media without audio streams', async () => {
    const tracks: TimelineTrack[] = [
      {
        id: 'track1',
        type: 'audio',
        layer: 0,
        segments: [
          {
            id: 'seg1',
            assetId: 'asset-no-audio',
            type: 'audio',
            time: { start: 0, duration: 5, sourceStart: 0 },
          },
        ],
      },
    ];

    const clipMediaMap = {
      'asset-no-audio': {
        media: {
          id: 'asset-no-audio',
          mediaData: {
            video: {
              codec: 'h264',
              width: 1920,
              height: 1080,
            },
          },
        },
        filePath: '/tmp/no-audio.mp4',
      } as any,
    };

    const outputSettings = {
      codec: 'libx264',
      format: 'mp4',
      resolution: '1920x1080',
    };

    await executor.execute(
      tracks,
      clipMediaMap,
      '/tmp/output.mp4',
      outputSettings
    );

    const executeSpy = vi.spyOn(ffmpegService, 'executeWithProgress');
    const args = executeSpy.mock.calls[0][0] as string[];
    const filterComplex = args[args.indexOf('-filter_complex') + 1];

    // Should not contain audio trim/delay for seg1
    expect(filterComplex).not.toContain('atrim');
    expect(filterComplex).not.toContain('adelay');
    // Should use anullsrc fallback for the mix
    expect(filterComplex).toContain('anullsrc');
  });
});
