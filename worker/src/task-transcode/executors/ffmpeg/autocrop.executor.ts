import { Injectable, Logger } from '@nestjs/common';
import { FFmpegService } from '../../../shared/services/ffmpeg.service';
import type { CropBox } from '@project/shared';

/** ffmpeg's default black threshold; 0–255. */
export const DEFAULT_CROPDETECT_LIMIT = 24;
export const DEFAULT_SAMPLE_COUNT = 5;
export const DEFAULT_SAMPLE_DURATION_SEC = 2;
export const DEFAULT_SAMPLE_FPS = 2;

export interface AutoCropExecutorConfig {
  /** cropdetect black threshold, 0–255 (default 24). */
  limit?: number;
  /** Sample windows spread across the media (default 5). */
  samples?: number;
  /** Seconds analysed per window (default 2). */
  sampleDuration?: number;
  /** Frames analysed per second within a window (default 2). */
  sampleFps?: number;
  /** Media duration, used to place the windows. */
  durationSec: number;
}

export interface AutoCropExecutorResult {
  /** One box per window that produced a usable detection. */
  boxes: CropBox[];
  /** Windows attempted, including those that yielded nothing. */
  attempted: number;
  /** The cropdetect limit actually used. */
  limit: number;
}

/**
 * Where to place the analysis windows.
 *
 * The outer 5% is skipped on both ends: fades, slates and black leader live
 * there, and a window landing on one detects "all black", which contributes
 * nothing. The remaining windows are spread evenly so a border that only
 * appears in part of the media (an inserted 4:3 archive clip) is still seen
 * by at least one of them — and the union then keeps the frame open for it.
 */
export function planSampleWindows(
  durationSec: number,
  samples: number,
  windowSec: number
): number[] {
  const count = Math.max(1, Math.floor(samples));
  if (!Number.isFinite(durationSec) || durationSec <= 0) return [0];

  const margin = durationSec * 0.05;
  const start = margin;
  const end = durationSec - margin - windowSec;
  if (count === 1 || end <= start) return [round3(start)];

  const step = (end - start) / (count - 1);
  return Array.from({ length: count }, (_, i) => round3(start + i * step));
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/**
 * Last `crop=w:h:x:y` cropdetect reported in a run's log.
 *
 * With `reset=0` cropdetect ACCUMULATES: each line is a superset of the one
 * before it, so the final line is that window's answer and the earlier lines
 * can be ignored.
 *
 * Values are DISPLAY pixels, not coded ones: ffmpeg's autorotate inserts the
 * rotation ahead of `-vf`, so cropdetect already sees the upright frame.
 * Verified against ffmpeg 7.0 — a 1920x1080 file with a 90° display matrix and
 * 560px side bars reports `crop=1080:800:0:560`, i.e. geometry in the
 * 1080x1920 display frame. This is why the step normalizes the box against
 * `mediaDisplayDimensions` rather than `Media.width/height`.
 *
 * Returns undefined when nothing was logged, and a non-positive box when the
 * window was entirely black — `unionCropBoxes` drops those.
 */
export function parseCropDetectBox(stderr: string): CropBox | undefined {
  const pattern = /crop=(-?\d+):(-?\d+):(-?\d+):(-?\d+)/g;
  let match: RegExpExecArray | null;
  let last: RegExpExecArray | null = null;
  while ((match = pattern.exec(stderr)) !== null) last = match;
  if (!last) return undefined;

  return {
    width: Number(last[1]),
    height: Number(last[2]),
    x: Number(last[3]),
    y: Number(last[4]),
  };
}

/**
 * FFmpeg implementation of the AutoCrop Executor.
 *
 * Runs `cropdetect` over a few short windows and hands the raw boxes back —
 * aggregating them into a recommendation, and deciding whether it is worth
 * applying, belongs to the shared pure helpers (`@project/shared`
 * utils/autocrop), not here.
 *
 * Each window is its own short ffmpeg invocation with `-f null -`: no output
 * file is written, and a window that fails (a bad seek, a corrupt GOP) costs
 * only that sample instead of the whole detection.
 */
@Injectable()
export class FFmpegAutoCropExecutor {
  private readonly logger = new Logger(FFmpegAutoCropExecutor.name);

  constructor(private readonly ffmpegService: FFmpegService) {}

  async execute(
    filePath: string,
    config: AutoCropExecutorConfig
  ): Promise<AutoCropExecutorResult> {
    const limit = config.limit ?? DEFAULT_CROPDETECT_LIMIT;
    const sampleDuration = config.sampleDuration ?? DEFAULT_SAMPLE_DURATION_SEC;
    const sampleFps = config.sampleFps ?? DEFAULT_SAMPLE_FPS;
    const offsets = planSampleWindows(
      config.durationSec,
      config.samples ?? DEFAULT_SAMPLE_COUNT,
      sampleDuration
    );

    this.logger.debug(
      `Detecting crop in ${filePath}: ${offsets.length} window(s) of ` +
        `${sampleDuration}s @ ${sampleFps}fps, limit=${limit}`
    );

    const boxes: CropBox[] = [];
    for (const offset of offsets) {
      const box = await this.detectWindow(
        filePath,
        offset,
        sampleDuration,
        sampleFps,
        limit
      );
      if (box) boxes.push(box);
    }

    return { boxes, attempted: offsets.length, limit };
  }

  private async detectWindow(
    filePath: string,
    offsetSec: number,
    durationSec: number,
    fps: number,
    limit: number
  ): Promise<CropBox | undefined> {
    const args = [
      '-hide_banner',
      '-nostdin',
      // `-loglevel info` is explicit because cropdetect reports at info level
      // and a quieter default would silently yield zero detections.
      '-loglevel',
      'info',
      // Input seek (before -i) so a window deep in a long file costs a seek
      // rather than a decode of everything preceding it.
      '-ss',
      offsetSec.toString(),
      '-i',
      filePath,
      '-t',
      durationSec.toString(),
      // `fps` first so cropdetect only inspects the frames we intend to pay
      // for. reset=0 accumulates within the window, making the final logged
      // line that window's bounding box.
      '-vf',
      `fps=${fps},cropdetect=limit=${limit}:round=2:reset=0`,
      '-an',
      '-sn',
      '-f',
      'null',
      '-',
    ];

    try {
      const stderr = await this.ffmpegService.executeCapturingStderr(args);
      const box = parseCropDetectBox(stderr);
      if (!box) {
        this.logger.debug(
          `No cropdetect output for window at ${offsetSec}s of ${filePath}`
        );
        return undefined;
      }
      this.logger.debug(
        `Window at ${offsetSec}s: crop=${box.width}:${box.height}:${box.x}:${box.y}`
      );
      return box;
    } catch (error) {
      // A single bad window degrades the sample set; the remaining windows
      // still produce a usable union, so this must not fail the step.
      this.logger.warn(
        `Crop detection failed for window at ${offsetSec}s of ${filePath}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return undefined;
    }
  }
}
