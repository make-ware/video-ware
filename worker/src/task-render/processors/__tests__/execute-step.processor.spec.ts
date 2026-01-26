import { ExecuteRenderStepProcessor } from '../execute-step.processor';
import { ProcessingProvider } from '@project/shared';
import * as fs from 'fs';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock fs.existsSync
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(),
    promises: {
      ...actual.promises,
      writeFile: vi.fn(),
    },
  };
});

// Mock path.extname to avoid issues if needed, but path is usually fine.
// We'll rely on real path module.

describe('ExecuteRenderStepProcessor', () => {
  let processor: ExecuteRenderStepProcessor;
  let ffmpegExecutor: any;
  let resolveClipsExecutor: any;
  let storageService: any;
  let pocketBaseService: any;
  let job: any;

  beforeEach(async () => {
    // Mock Services
    ffmpegExecutor = {
      execute: vi.fn().mockResolvedValue({
        outputPath: '/tmp/output.mp4',
        probeOutput: {},
      }),
    };

    resolveClipsExecutor = {
      execute: vi.fn().mockResolvedValue({
        clipMediaMap: {
          media1: { filePath: '/original/path.mp4', media: { id: 'media1' } },
        },
      }),
    };

    storageService = {
      getRenderInputPath: vi.fn().mockReturnValue('/deterministic/path.mp4'),
      createRenderDir: vi.fn().mockResolvedValue(undefined),
      getRenderOutputPath: vi.fn().mockReturnValue('/output/render.mp4'),
    };

    pocketBaseService = {
      logUsageEvent: vi.fn().mockResolvedValue(undefined),
    };

    job = {
      data: {
        workspaceId: 'ws1',
        taskId: 'task1',
        provider: ProcessingProvider.FFMPEG,
      },
      updateProgress: vi.fn(),
    };

    /*
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExecuteRenderStepProcessor,
        { provide: FFmpegComposeExecutor, useValue: ffmpegExecutor },
        { provide: FFmpegResolveClipsExecutor, useValue: resolveClipsExecutor },
        { provide: StorageService, useValue: storageService },
        { provide: PocketBaseService, useValue: pocketBaseService },
      ],
    }).compile();

    processor = module.get<ExecuteRenderStepProcessor>(ExecuteRenderStepProcessor);
    */

    // Manual instantiation to avoid DI issues
    processor = new ExecuteRenderStepProcessor(
      ffmpegExecutor,
      resolveClipsExecutor,
      storageService,
      pocketBaseService
    );
  });

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });

  it('should execute rendering pipeline successfully', async () => {
    // Mock fs.existsSync to return true for deterministic path
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const input = {
      type: 'execute' as const,
      timelineId: 'tl1',
      tracks: [],
      outputSettings: { format: 'mp4', codec: 'h264', resolution: '1080p' },
    };

    const result = await processor.process(input, job);

    // 1. Should resolve clips
    expect(resolveClipsExecutor.execute).toHaveBeenCalledWith('tl1', []);

    // 2. Should check for deterministic path
    expect(storageService.getRenderInputPath).toHaveBeenCalledWith(
      'ws1',
      'task1',
      'media1',
      '.mp4'
    );
    expect(fs.existsSync).toHaveBeenCalledWith('/deterministic/path.mp4');

    // 3. Should call ffmpeg executor with updated path
    expect(ffmpegExecutor.execute).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        media1: expect.objectContaining({
          filePath: '/deterministic/path.mp4',
        }),
      }),
      '/output/render.mp4',
      input.outputSettings,
      expect.any(Function)
    );

    // 4. Should log usage
    expect(pocketBaseService.logUsageEvent).toHaveBeenCalled();

    // 5. Should return output
    expect(result).toEqual({
      outputPath: '/tmp/output.mp4',
      storagePath: 'renders/ws1/task1/output.mp4',
      isLocal: true,
      probeOutput: {},
    });
  });

  it('should fallback to original path if deterministic path missing', async () => {
    // Mock fs.existsSync to return false
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const input = {
      type: 'execute' as const,
      timelineId: 'tl1',
      tracks: [],
      outputSettings: { format: 'mp4', codec: 'h264', resolution: '1080p' },
    };

    await processor.process(input, job);

    // Should call ffmpeg executor with ORIGINAL path
    expect(ffmpegExecutor.execute).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        media1: expect.objectContaining({ filePath: '/original/path.mp4' }),
      }),
      expect.any(String),
      expect.any(Object),
      expect.any(Function)
    );
  });
});
