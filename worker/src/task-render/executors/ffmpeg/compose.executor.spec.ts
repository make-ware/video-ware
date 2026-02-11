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

  it('should build correct FFmpeg command for composite clip (multiple segments from same source)', async () => {
    // Simulates expanded composite clip: 4 segments stitched from same media
    // Segments: 1.8-8.7 (6.9s), 12.3-13.5 (1.2s), 14.8-23.1 (8.3s), 28.9-31.1 (2.2s)
    const tracks: TimelineTrack[] = [
      {
        id: 'track1',
        type: 'video',
        layer: 0,
        segments: [
          {
            id: 'seg_0',
            assetId: 'media1',
            type: 'video',
            time: {
              start: 0,
              duration: 6.9,
              sourceStart: 1.8,
            },
          },
          {
            id: 'seg_1',
            assetId: 'media1',
            type: 'video',
            time: {
              start: 6.9,
              duration: 1.2,
              sourceStart: 12.3,
            },
          },
          {
            id: 'seg_2',
            assetId: 'media1',
            type: 'video',
            time: {
              start: 8.1,
              duration: 8.3,
              sourceStart: 14.8,
            },
          },
          {
            id: 'seg_3',
            assetId: 'media1',
            type: 'video',
            time: {
              start: 16.4,
              duration: 2.2,
              sourceStart: 28.9,
            },
          },
        ],
      },
    ];

    const clipMediaMap = {
      media1: { media: { id: 'media1' }, filePath: '/tmp/source.mp4' } as any,
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

    // Verify trim uses correct sourceStart for each segment
    expect(filterComplex).toContain('trim=start=1.8:duration=6.9');
    expect(filterComplex).toContain('trim=start=12.3:duration=1.2');
    expect(filterComplex).toContain('trim=start=14.8:duration=8.3');
    expect(filterComplex).toContain('trim=start=28.9:duration=2.2');

    // Verify setpts uses correct timeline start for each segment
    expect(filterComplex).toContain('PTS-STARTPTS+0/TB');
    expect(filterComplex).toContain('PTS-STARTPTS+6.9/TB');
    expect(filterComplex).toContain('PTS-STARTPTS+8.1/TB');
    expect(filterComplex).toContain('PTS-STARTPTS+16.4/TB');

    // Verify overlay enable windows match timeline positions
    expect(filterComplex).toContain("enable='between(t,0,6.9)'");
    expect(filterComplex).toContain("enable='between(t,6.9,8.1)'");
    expect(filterComplex).toContain("enable='between(t,8.1,16.4)'");
    expect(filterComplex).toContain("enable='between(t,16.4,18.6)'");

    // Verify base duration covers total (18.6s)
    expect(filterComplex).toContain('d=18.6');
  });

  it('should handle composite clip with non-zero timeline start', async () => {
    // Composite clip placed at 10s on timeline (e.g., after another clip)
    const tracks: TimelineTrack[] = [
      {
        id: 'track1',
        type: 'video',
        layer: 0,
        segments: [
          {
            id: 'seg_0',
            assetId: 'media1',
            type: 'video',
            time: {
              start: 10,
              duration: 3.3,
              sourceStart: 1.8,
            },
          },
          {
            id: 'seg_1',
            assetId: 'media1',
            type: 'video',
            time: {
              start: 13.3,
              duration: 1.2,
              sourceStart: 12.3,
            },
          },
        ],
      },
    ];

    const clipMediaMap = {
      media1: { media: { id: 'media1' }, filePath: '/tmp/source.mp4' } as any,
    };

    const executeSpy = vi.spyOn(ffmpegService, 'executeWithProgress');
    await executor.execute(tracks, clipMediaMap, '/tmp/output.mp4', {
      codec: 'libx264',
      format: 'mp4',
      resolution: '1920x1080',
    });

    const args = executeSpy.mock.calls[0][0] as string[];
    const filterComplex = args[args.indexOf('-filter_complex') + 1];

    expect(filterComplex).toContain('trim=start=1.8:duration=3.3');
    expect(filterComplex).toContain('trim=start=12.3:duration=1.2');
    expect(filterComplex).toContain("enable='between(t,10,13.3)'");
    expect(filterComplex).toContain("enable='between(t,13.3,14.5)'");
    expect(filterComplex).toContain('PTS-STARTPTS+10/TB');
    expect(filterComplex).toContain('PTS-STARTPTS+13.3/TB');
    expect(filterComplex).toContain('d=14.5');
  });

  it('should handle composite clip with single segment', async () => {
    const tracks: TimelineTrack[] = [
      {
        id: 'track1',
        type: 'video',
        layer: 0,
        segments: [
          {
            id: 'seg_0',
            assetId: 'media1',
            type: 'video',
            time: {
              start: 0,
              duration: 4.5,
              sourceStart: 2.1,
            },
          },
        ],
      },
    ];

    const clipMediaMap = {
      media1: { media: { id: 'media1' }, filePath: '/tmp/source.mp4' } as any,
    };

    const executeSpy = vi.spyOn(ffmpegService, 'executeWithProgress');
    await executor.execute(tracks, clipMediaMap, '/tmp/output.mp4', {
      codec: 'libx264',
      format: 'mp4',
      resolution: '1920x1080',
    });

    const args = executeSpy.mock.calls[0][0] as string[];
    const filterComplex = args[args.indexOf('-filter_complex') + 1];

    expect(filterComplex).toContain('trim=start=2.1:duration=4.5');
    expect(filterComplex).toContain("enable='between(t,0,4.5)'");
    expect(filterComplex).toContain('d=4.5');
  });

  it('should handle mixed composite and regular clips on same track', async () => {
    // Regular clip 0-5, then composite (2 segments) 5-12
    const tracks: TimelineTrack[] = [
      {
        id: 'track1',
        type: 'video',
        layer: 0,
        segments: [
          {
            id: 'regular',
            assetId: 'media1',
            type: 'video',
            time: { start: 0, duration: 5, sourceStart: 0 },
          },
          {
            id: 'comp_0',
            assetId: 'media2',
            type: 'video',
            time: {
              start: 5,
              duration: 4,
              sourceStart: 1.8,
            },
          },
          {
            id: 'comp_1',
            assetId: 'media2',
            type: 'video',
            time: {
              start: 9,
              duration: 3,
              sourceStart: 12.3,
            },
          },
        ],
      },
    ];

    const clipMediaMap = {
      media1: { media: { id: 'media1' }, filePath: '/tmp/a.mp4' } as any,
      media2: { media: { id: 'media2' }, filePath: '/tmp/b.mp4' } as any,
    };

    const executeSpy = vi.spyOn(ffmpegService, 'executeWithProgress');
    await executor.execute(tracks, clipMediaMap, '/tmp/output.mp4', {
      codec: 'libx264',
      format: 'mp4',
      resolution: '1920x1080',
    });

    const args = executeSpy.mock.calls[0][0] as string[];
    const filterComplex = args[args.indexOf('-filter_complex') + 1];

    expect(filterComplex).toContain("enable='between(t,0,5)'");
    expect(filterComplex).toContain("enable='between(t,5,9)'");
    expect(filterComplex).toContain("enable='between(t,9,12)'");
    expect(filterComplex).toContain('trim=start=0:duration=5');
    expect(filterComplex).toContain('trim=start=1.8:duration=4');
    expect(filterComplex).toContain('trim=start=12.3:duration=3');
  });

  it('should produce clean decimal values (no floating-point artifacts)', async () => {
    // Values that often cause JS float issues: 0.1 + 0.2, or 6.9 + 1.2 + 8.3 + 2.2
    const tracks: TimelineTrack[] = [
      {
        id: 'track1',
        type: 'video',
        layer: 0,
        segments: [
          {
            id: 'seg_0',
            assetId: 'm1',
            type: 'video',
            time: { start: 0, duration: 0.3, sourceStart: 0.1 },
          },
          {
            id: 'seg_1',
            assetId: 'm1',
            type: 'video',
            time: { start: 0.3, duration: 0.3, sourceStart: 0.5 },
          },
          {
            id: 'seg_2',
            assetId: 'm1',
            type: 'video',
            time: { start: 0.6, duration: 0.3, sourceStart: 0.8 },
          },
        ],
      },
    ];

    const clipMediaMap = {
      m1: { media: { id: 'm1' }, filePath: '/tmp/source.mp4' } as any,
    };

    const executeSpy = vi.spyOn(ffmpegService, 'executeWithProgress');
    await executor.execute(tracks, clipMediaMap, '/tmp/output.mp4', {
      codec: 'libx264',
      format: 'mp4',
      resolution: '1920x1080',
    });

    const args = executeSpy.mock.calls[0][0] as string[];
    const filterComplex = args[args.indexOf('-filter_complex') + 1];

    // Should NOT contain floating-point artifacts like 0.8999999999999999 or 0.6000000000000001
    expect(filterComplex).not.toMatch(/18\.59+9/);
    expect(filterComplex).not.toMatch(/0\.89+9/);
    expect(filterComplex).not.toMatch(/0\.60+0+1/);
    // Should have clean rounded values
    expect(filterComplex).toContain('d=0.9');
    expect(filterComplex).toContain("enable='between(t,0.6,0.9)'");
  });

  it('should handle audio segments from composite clip (same source, multiple segments)', async () => {
    const tracks: TimelineTrack[] = [
      {
        id: 'video',
        type: 'video',
        layer: 0,
        segments: [
          {
            id: 'v1',
            assetId: 'media1',
            type: 'video',
            time: { start: 0, duration: 3, sourceStart: 1 },
          },
          {
            id: 'v2',
            assetId: 'media1',
            type: 'video',
            time: { start: 3, duration: 2, sourceStart: 10 },
          },
        ],
      },
      {
        id: 'audio',
        type: 'audio',
        layer: 0,
        segments: [
          {
            id: 'a1',
            assetId: 'media1',
            type: 'audio',
            time: { start: 0, duration: 3, sourceStart: 1 },
          },
          {
            id: 'a2',
            assetId: 'media1',
            type: 'audio',
            time: { start: 3, duration: 2, sourceStart: 10 },
          },
        ],
      },
    ];

    const clipMediaMap = {
      media1: {
        media: {
          id: 'media1',
          mediaData: { audio: true },
        },
        filePath: '/tmp/source.mp4',
      } as any,
    };

    const executeSpy = vi.spyOn(ffmpegService, 'executeWithProgress');
    await executor.execute(tracks, clipMediaMap, '/tmp/output.mp4', {
      codec: 'libx264',
      format: 'mp4',
      resolution: '1920x1080',
    });

    const args = executeSpy.mock.calls[0][0] as string[];
    const filterComplex = args[args.indexOf('-filter_complex') + 1];

    expect(filterComplex).toContain('atrim=start=1:duration=3');
    expect(filterComplex).toContain('atrim=start=10:duration=2');
    expect(filterComplex).toContain('adelay=0|0');
    expect(filterComplex).toContain('adelay=3000|3000');
  });

  it('should handle multiple tracks with different layer order', async () => {
    const tracks: TimelineTrack[] = [
      {
        id: 't0',
        type: 'video',
        layer: 0,
        segments: [
          {
            id: 's0',
            assetId: 'bg',
            type: 'video',
            time: { start: 0, duration: 10, sourceStart: 0 },
          },
        ],
      },
      {
        id: 't1',
        type: 'video',
        layer: 1,
        segments: [
          {
            id: 's1',
            assetId: 'fg',
            type: 'video',
            time: { start: 2, duration: 4, sourceStart: 0 },
            video: { x: 50, y: 50, width: 200, height: 200 },
          },
        ],
      },
    ];

    const clipMediaMap = {
      bg: { media: { id: 'bg' }, filePath: '/tmp/bg.mp4' } as any,
      fg: { media: { id: 'fg' }, filePath: '/tmp/fg.mp4' } as any,
    };

    const executeSpy = vi.spyOn(ffmpegService, 'executeWithProgress');
    await executor.execute(tracks, clipMediaMap, '/tmp/output.mp4', {
      codec: 'libx264',
      format: 'mp4',
      resolution: '1920x1080',
    });

    const args = executeSpy.mock.calls[0][0] as string[];
    const filterComplex = args[args.indexOf('-filter_complex') + 1];

    expect(filterComplex).toContain('scale=200:200');
    expect(filterComplex).toContain('overlay=x=50:y=50');
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
