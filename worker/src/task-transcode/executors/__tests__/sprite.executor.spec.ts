import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FFmpegSpriteExecutor } from '../ffmpeg/sprite.executor';
import type { SpriteConfig } from '../interfaces';

vi.mock('@nestjs/common', async () => {
  const actual = await vi.importActual('@nestjs/common');
  const { MockLogger } = await import('@/__mocks__/logger');
  return { ...actual, Logger: MockLogger };
});

/** The tile dimensions ffmpeg was actually told to scale to. */
function scaledTo(generateSprite: ReturnType<typeof vi.fn>) {
  const [, , , , , tileWidth, tileHeight] = generateSprite.mock.calls[0];
  return { tileWidth, tileHeight };
}

describe('FFmpegSpriteExecutor geometry', () => {
  let ffmpegService: { generateSprite: ReturnType<typeof vi.fn> };
  let executor: FFmpegSpriteExecutor;

  const config = (overrides: Partial<SpriteConfig> = {}): SpriteConfig => ({
    fps: 1,
    cols: 100,
    rows: 1,
    tileWidth: 320,
    tileHeight: 180,
    ...overrides,
  });

  beforeEach(() => {
    ffmpegService = { generateSprite: vi.fn().mockResolvedValue(undefined) };
    executor = new FFmpegSpriteExecutor(ffmpegService as never);
  });

  it('reports the same geometry it hands to ffmpeg', async () => {
    const result = await executor.execute(
      '/in.mp4',
      '/out.jpg',
      config({ sourceWidth: 1080, sourceHeight: 1080 })
    );

    expect(scaledTo(ffmpegService.generateSprite)).toEqual({
      tileWidth: result.tileWidth,
      tileHeight: result.tileHeight,
    });
    expect(result).toMatchObject({
      outputPath: '/out.jpg',
      cols: 100,
      rows: 1,
      fps: 1,
      tileWidth: 320,
      tileHeight: 320, // square source, not the requested 180
      sheetWidth: 32000,
      sheetHeight: 320,
    });
  });

  it('overrides a requested tile height that fights the source aspect', async () => {
    // The exact bug: a caller asks for 320x180 tiles on portrait media.
    const result = await executor.execute(
      '/in.mp4',
      '/out.jpg',
      config({ sourceWidth: 1080, sourceHeight: 1920 })
    );

    expect(result.tileHeight).toBe(570);
    expect(scaledTo(ffmpegService.generateSprite).tileHeight).toBe(570);
  });

  it('shapes tiles to the display dimensions, not the coded ones', async () => {
    // Rotated phone clip: coded 1920x1080 + 90° matrix, so ffmpeg autorotates
    // to 1080x1920 before the scale filter sees a frame.
    const result = await executor.execute(
      '/in.mp4',
      '/out.jpg',
      config({
        sourceWidth: 1920,
        sourceHeight: 1080,
        sourceDisplayWidth: 1080,
        sourceDisplayHeight: 1920,
      })
    );

    expect(result.tileHeight).toBe(570);
  });

  it('keeps 16:9 sources at the requested height', async () => {
    const result = await executor.execute(
      '/in.mp4',
      '/out.jpg',
      config({
        sourceWidth: 3840,
        sourceHeight: 2160,
        sourceDisplayWidth: 3840,
        sourceDisplayHeight: 2160,
      })
    );

    expect(result.tileHeight).toBe(180);
  });

  it('always produces an even, positive tile height', async () => {
    const result = await executor.execute(
      '/in.mp4',
      '/out.jpg',
      config({ sourceWidth: 1440, sourceHeight: 1079 })
    );

    expect(result.tileHeight % 2).toBe(0);
    expect(result.tileHeight).toBeGreaterThan(0);
  });

  it('falls back to the requested height when the source size is unknown', async () => {
    const result = await executor.execute('/in.mp4', '/out.jpg', config());

    expect(result.tileHeight).toBe(180);
    expect(scaledTo(ffmpegService.generateSprite).tileHeight).toBe(180);
  });

  it('never asks ffmpeg to scale to a zero height', async () => {
    const result = await executor.execute(
      '/in.mp4',
      '/out.jpg',
      config({ tileHeight: 0 })
    );

    expect(result.tileHeight).toBe(180); // 16:9 last resort
  });

  it('passes the grid and start time through untouched', async () => {
    const result = await executor.execute(
      '/in.mp4',
      '/out.jpg',
      config({ fps: 0, cols: 1, rows: 1, sourceWidth: 800, sourceHeight: 600 }),
      42
    );

    expect(ffmpegService.generateSprite).toHaveBeenCalledWith(
      '/in.mp4',
      '/out.jpg',
      0,
      1,
      1,
      320,
      240,
      42
    );
    expect(result).toMatchObject({
      fps: 0,
      cols: 1,
      rows: 1,
      sheetWidth: 320,
      sheetHeight: 240,
    });
  });
});
