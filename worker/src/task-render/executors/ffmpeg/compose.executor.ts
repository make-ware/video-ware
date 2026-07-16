import { Injectable, Logger, Inject } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { FFmpegService } from '../../../shared/services/ffmpeg.service';
import type { IRenderExecutor, RenderExecutorResult } from '../interfaces';
import type {
  RenderTimelinePayload,
  Media,
  TimelineTrack,
} from '@project/shared';
import { planRenderWindows, clipTracksToWindow } from './render-windows';

/**
 * Every segment branch is normalized to the output frame rate and the black
 * base canvas generates at it too, so the overlay chain's framesync always
 * sees aligned timestamps. A VFR source (or a source at a different rate than
 * the base) otherwise makes framesync buffer frames while waiting for a
 * partner timestamp — one of the unbounded-memory paths in a long timeline.
 * Note: the base `color` source previously ran at its 25fps default, so this
 * is also an explicit output-rate bump from 25 to 30.
 */
const DEFAULT_RENDER_FPS = 30;

/**
 * Output rate from settings, integer rates only (24/25/30/60…). The whole
 * frame-grid quantization below assumes an integer fps, so anything else
 * falls back to the default rather than producing a subtly-misaligned grid.
 */
const resolveRenderFps = (fps: number | undefined): number =>
  fps !== undefined && Number.isInteger(fps) && fps >= 1 && fps <= 120
    ? fps
    : DEFAULT_RENDER_FPS;

/**
 * Bounded multi-pass render (Tier 2). ffmpeg opens every demuxer + decoder
 * at startup, so a single-pass render of a heavily segmented timeline
 * (one seeked input per segment) exhausts threads (pthread_create EAGAIN,
 * observed at ~137 HEVC inputs) and then memory (each open HEVC decoder
 * holds reference-frame buffers — kernel OOM kill). Above the input cap the
 * timeline renders in sequential time windows (video-only parts), audio
 * renders in one cheap full-timeline pass, and a lossless concat assembles
 * the output — peak memory/threads become independent of timeline length.
 */
const DEFAULT_MAX_INPUTS_PER_PASS = 24;
const DEFAULT_RENDER_WINDOW_SEC = 60;

/**
 * All parts share one exact, fps-divisible mp4 timescale (512 × fps) so
 * concat-copied parts join without timestamp rounding drift.
 */
const partVideoTimescale = (fps: number): number => 512 * fps;

const intFromEnv = (name: string, fallback: number): number => {
  const raw = process.env[name];
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * Pass shape for buildFFmpegCommand. 'full' is the single-pass path,
 * byte-identical to the pre-Tier-2 behaviour. 'video-only' renders one
 * window's visual tracks (no audio graph, part timescale pinned);
 * 'audio-only' renders the whole timeline's audio graph (no canvas, no
 * video encode).
 */
interface BuildOptions {
  mode: 'full' | 'video-only' | 'audio-only';
  /**
   * Exact duration for the black base canvas. A window must pad to its
   * planned end even when its content ends early — a short part would
   * desynchronize everything after it at concat time.
   */
  totalDurationOverride?: number;
}

/**
 * Image formats safe for `-loop 1` input-level looping (image2 demuxer).
 * Anything else typed as an image (e.g. gif — its demuxer rejects `-loop`)
 * keeps the loop-filter chain instead.
 */
const STATIC_IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.bmp',
  '.tif',
  '.tiff',
]);

/**
 * FFmpeg-based executor for composing timelines
 * Pure operation - builds and executes FFmpeg command
 *
 * Memory-stability contract (the render OOM fixes live here):
 * - One seeked input (`-ss`/`-t` before `-i`) per segment, so FFmpeg decodes
 *   only each segment's window instead of whole sources through `trim`.
 * - Branches are fps-normalized (output fps) so framesync buffering stays
 *   bounded. Threading is left to ffmpeg's auto-sizing — with the above in
 *   place, threads scale the working set only linearly.
 * - Above RENDER_MAX_INPUTS_PER_PASS total inputs, the render switches to
 *   the bounded multi-pass mode (see executeMultiPass): windowed video-only
 *   passes + one audio pass + lossless concat, so peak decoder count is
 *   capped no matter how long the timeline is.
 *
 * Frame-exactness contract (the black-frame-at-cut fixes live here):
 * - Every visual segment's timeline placement is quantized to whole output
 *   frames (frameOf), so segments that touch in ms-time tile exactly —
 *   composite-clip cuts can't leave an output frame owned by neither side.
 * - Overlay enable windows sit on half-frame offsets, immune to float
 *   rounding at boundaries; eof_action=repeat holds a branch's last frame
 *   through its window when the decode comes up short (24fps source on a
 *   30fps grid, VFR, seek slop) instead of flashing the black canvas.
 * - Audio stays on the millisecond grid: cut precision for dialogue is
 *   higher there, and a ≤half-frame AV skew is imperceptible.
 */
@Injectable()
export class FFmpegComposeExecutor implements IRenderExecutor {
  private readonly logger = new Logger(FFmpegComposeExecutor.name);

  constructor(
    @Inject(FFmpegService) private readonly ffmpegService: FFmpegService
  ) {
    if (!this.ffmpegService) {
      this.logger.error('FFmpegService is undefined in constructor!');
    } else {
      this.logger.log('FFmpegService injected successfully');
    }
  }

  async execute(
    tracks: RenderTimelinePayload['tracks'],
    clipMediaMap: Record<string, { media: Media; filePath: string }>,
    outputPath: string,
    outputSettings: RenderTimelinePayload['outputSettings'],
    onProgress?: (progress: number) => void
  ): Promise<RenderExecutorResult> {
    this.logger.log(`Composing timeline with ${tracks.length} tracks`);

    if (!this.ffmpegService) {
      throw new Error(
        'FFmpegService is not available (this.ffmpegService is undefined)'
      );
    }

    let inputCount: number | undefined;
    try {
      // Build FFmpeg command for timeline composition
      const {
        args: ffmpegArgs,
        totalDuration,
        inputCount: builtInputCount,
      } = this.buildFFmpegCommand(
        tracks,
        clipMediaMap,
        outputPath,
        outputSettings
      );
      inputCount = builtInputCount;

      this.logger.log(
        `Timeline graph: ${inputCount} ffmpeg inputs across ` +
          `${tracks.length} tracks, ${totalDuration}s`
      );

      const maxInputsPerPass = intFromEnv(
        'RENDER_MAX_INPUTS_PER_PASS',
        DEFAULT_MAX_INPUTS_PER_PASS
      );
      if (inputCount <= maxInputsPerPass) {
        // Execute FFmpeg with progress tracking against the known timeline
        // duration (the first input's duration is meaningless for a
        // composition)
        await this.ffmpegService.executeWithProgress(
          ffmpegArgs,
          onProgress || (() => {}),
          totalDuration
        );
      } else {
        await this.executeMultiPass(
          tracks,
          clipMediaMap,
          outputPath,
          outputSettings,
          totalDuration,
          maxInputsPerPass,
          onProgress
        );
      }

      // Probe the rendered video to get metadata
      const probeResult = await this.ffmpegService.probe(outputPath);

      // Convert ProbeResult to ProbeOutput format
      const videoStream = probeResult.streams.find(
        (s) => s.codec_type === 'video'
      ) as (typeof probeResult.streams)[0] & {
        r_frame_rate?: string;
        avg_frame_rate?: string;
        width?: number;
        height?: number;
      };

      if (!videoStream) {
        throw new Error('No video stream found in rendered file');
      }

      // Parse FPS from FFmpeg format (e.g., "30/1" -> 30)
      const parseFps = (fpsString: string | undefined): number => {
        if (!fpsString) return 0;
        const [num, den] = fpsString.split('/').map(Number);
        return den && den > 0 ? num / den : 0;
      };

      const probeOutput = {
        duration: parseFloat(String(probeResult.format.duration)) || 0,
        width: videoStream.width || 0,
        height: videoStream.height || 0,
        displayWidth: videoStream.width || 0,
        displayHeight: videoStream.height || 0,
        rotation: 0, // Rendered output has no rotation
        codec: videoStream.codec_name || 'unknown',
        fps:
          parseFps(videoStream.r_frame_rate || videoStream.avg_frame_rate) || 0,
        bitrate: parseInt(String(probeResult.format.bit_rate)) || undefined,
        format: probeResult.format.format_name || 'unknown',
        size: parseInt(String(probeResult.format.size)) || undefined,
      };

      this.logger.log(`Timeline composition completed: ${outputPath}`);
      return { outputPath, probeOutput, isLocal: true };
    } catch (error) {
      // Append the graph shape to the propagated message — the job failure
      // record is often all an operator sees, and "N inputs" is the number
      // that explains thread/memory exhaustion on segmented timelines.
      if (error instanceof Error && inputCount !== undefined) {
        error.message += ` [render graph: ${inputCount} inputs across ${tracks.length} tracks]`;
      }
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Timeline composition failed: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Bounded multi-pass render: sequential video-only window passes, one
   * full-timeline audio pass, then a lossless concat + mux. Intermediates
   * live in `<renderDir>/parts/`, which the existing cleanupRenderDir (and
   * stale sweep) reclaim — no extra cleanup needed here, on failure either.
   */
  private async executeMultiPass(
    tracks: TimelineTrack[],
    clipMediaMap: Record<string, { media: Media; filePath: string }>,
    outputPath: string,
    outputSettings: RenderTimelinePayload['outputSettings'],
    totalDuration: number,
    maxInputsPerPass: number,
    onProgress?: (progress: number) => void
  ): Promise<void> {
    const windowSec = intFromEnv(
      'RENDER_WINDOW_SEC',
      DEFAULT_RENDER_WINDOW_SEC
    );
    const windows = planRenderWindows(tracks, totalDuration, {
      windowSec,
      maxInputsPerPass,
    });
    const partsDir = path.join(path.dirname(outputPath), 'parts');
    await fs.promises.mkdir(partsDir, { recursive: true });

    this.logger.log(
      `Bounded multi-pass render: ${windows.length} video windows ` +
        `(≤${maxInputsPerPass} inputs/pass, target ${windowSec}s/window) ` +
        `+ audio pass + concat`
    );

    const report = onProgress || (() => {});

    // Pass A: sequential per-window video-only renders → 0–90% of progress,
    // weighted by window duration.
    const partPaths: string[] = [];
    let renderedSec = 0;
    for (const [i, window] of windows.entries()) {
      const windowLen = window.end - window.start;
      if (window.inputCount > maxInputsPerPass) {
        this.logger.warn(
          `Render window ${i} [${window.start}s–${window.end}s] overlaps ` +
            `${window.inputCount} inputs (cap ${maxInputsPerPass}) — ` +
            `simultaneously stacked clips cannot be split by time, so this ` +
            `pass opens them all; it may still exhaust threads/memory`
        );
      }
      const partPath = path.join(
        partsDir,
        `part-${String(i).padStart(3, '0')}.mp4`
      );
      const { args } = this.buildFFmpegCommand(
        clipTracksToWindow(tracks, window),
        clipMediaMap,
        partPath,
        outputSettings,
        { mode: 'video-only', totalDurationOverride: windowLen }
      );
      this.logger.debug(
        `Rendering window ${i + 1}/${windows.length} ` +
          `[${window.start}s–${window.end}s], ${window.inputCount} inputs`
      );
      const baseSec = renderedSec;
      await this.ffmpegService.executeWithProgress(
        args,
        (p) => report(((baseSec + (p / 100) * windowLen) / totalDuration) * 90),
        windowLen
      );
      renderedSec += windowLen;
      partPaths.push(partPath);
    }

    // Pass B: one full-timeline audio-only pass → 90–97%. Audio decoders are
    // cheap (no frame threads, no reference-frame buffers), and a single pass
    // keeps per-segment afades intact and avoids AAC priming-gap artifacts
    // that windowed audio would produce at every concat join.
    const audioPath = path.join(partsDir, 'audio.m4a');
    const { args: audioArgs } = this.buildFFmpegCommand(
      tracks,
      clipMediaMap,
      audioPath,
      outputSettings,
      { mode: 'audio-only' }
    );
    this.logger.debug(`Rendering audio pass (${totalDuration}s)`);
    await this.ffmpegService.executeWithProgress(
      audioArgs,
      (p) => report(90 + (p / 100) * 7),
      totalDuration
    );

    // Pass C: lossless assembly → 97–100%. Parts share codec settings and
    // timescale, so the concat demuxer stream-copies them; audio is already
    // aac and is stream-copied too.
    const listPath = path.join(partsDir, 'list.txt');
    const escapeConcatPath = (p: string) => p.replace(/'/g, "'\\''");
    await fs.promises.writeFile(
      listPath,
      partPaths.map((p) => `file '${escapeConcatPath(p)}'`).join('\n') + '\n',
      'utf8'
    );
    const concatArgs = [
      '-y',
      '-nostdin',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      listPath,
      '-i',
      audioPath,
      '-map',
      '0:v',
      '-map',
      '1:a',
      '-c',
      'copy',
      '-f',
      outputSettings.format,
      outputPath,
    ];
    this.logger.debug(
      `Concatenating ${partPaths.length} parts + audio into ${outputPath}`
    );
    await this.ffmpegService.executeWithProgress(
      concatArgs,
      (p) => report(97 + (p / 100) * 3),
      totalDuration
    );
    report(100);
  }

  /**
   * Build FFmpeg command for timeline composition.
   * Returns the args plus the computed timeline duration (for progress
   * tracking and stall detection in the caller).
   */
  private buildFFmpegCommand(
    tracks: TimelineTrack[],
    clipMediaMap: Record<string, { media: Media; filePath: string }>,
    outputPath: string,
    outputSettings: RenderTimelinePayload['outputSettings'],
    options: BuildOptions = { mode: 'full' }
  ): { args: string[]; totalDuration: number; inputCount: number } {
    // -y: overwrite output without prompting. -nostdin: never read stdin, so
    // ffmpeg can't pause waiting for interactive input under a job runner.
    const args: string[] = ['-y', '-nostdin'];
    const filterComplex: string[] = [];
    let inputCounter = 0;

    const fps = resolveRenderFps(outputSettings.fps);

    // ---- Frame-grid quantization (the black-frame-at-cut-points fix) ----
    //
    // Segment times arrive on the millisecond grid, but output frames live on
    // the 1/fps grid — neither grid contains the other, so a cut like 10.234s
    // falls BETWEEN frames. Rendered naively, each such cut can leave 1–2
    // frame slots covered by neither neighbor (the earlier branch's decoded
    // frames run out before its enable window closes, and the later branch's
    // first frame gets snapped to a slot its enable window hasn't opened
    // yet), which the overlay then fills with the black base canvas.
    //
    // Instead, every visual segment is quantized to whole output frames:
    // start/end round to the nearest frame boundary, so segments that touch
    // in ms-time tile exactly in frame-time. Rounding goes through integer
    // milliseconds first so two float expressions of the same boundary (e.g.
    // a segment end summed as start+duration vs. the next segment's start)
    // can never round to different frames.
    const frameOf = (t: number): number =>
      Math.round((Math.round(t * 1000) * fps) / 1000);

    // Seconds formatter for filtergraph/args values: µs precision, no float
    // artifacts (18.599999999999998) and no trailing zeros. Frame-grid values
    // like 307/30 print as 10.233333 — the sub-µs error is absorbed by fps
    // rounding and the half-frame enable offsets below.
    const fmtSec = (t: number): string => String(Number(t.toFixed(6)));

    // One seeked input PER SEGMENT (not per asset): `-ss`/`-t` before `-i`
    // seeks the demuxer to the keyframe before the window and stops after
    // `duration`, so frames outside the window never enter the filtergraph.
    // The previous model (`-i` per asset + `trim` filters) decoded every
    // source in full from t=0 and fanned the frames into every segment
    // branch — the dominant render OOM driver. N segments of one asset now
    // open N window-bounded demuxers instead, which is far cheaper.
    // Values are expected to be rounded (fmtTime/frame grid) by the caller.
    const addSeekedInput = (
      filePath: string,
      sourceStart: number,
      duration: number
    ): number => {
      if (sourceStart > 0) {
        args.push('-ss', fmtSec(sourceStart));
      }
      args.push('-t', fmtSec(duration), '-i', filePath);
      return inputCounter++;
    };

    // Static images loop one frame at input level for the segment duration.
    const addImageInput = (filePath: string, duration: number): number => {
      args.push('-loop', '1', '-t', fmtSec(duration), '-i', filePath);
      return inputCounter++;
    };

    // Unbounded input for formats whose demuxer rejects `-loop` (e.g. gif);
    // the branch's loop/trim filters bound it instead.
    const addPlainInput = (filePath: string): number => {
      args.push('-i', filePath);
      return inputCounter++;
    };

    // Calculate output dimensions
    let [targetWidth, targetHeight] = outputSettings.resolution
      .split('x')
      .map(Number);

    // Normalize dimensions to match requested orientation. Sources mismatched
    // with the timeline canvas are letterboxed (force_original_aspect_ratio
    // below), so we never stretch — we just rotate the canvas.
    if (
      outputSettings.orientation === 'portrait' &&
      targetWidth > targetHeight
    ) {
      [targetWidth, targetHeight] = [targetHeight, targetWidth];
    } else if (
      outputSettings.orientation === 'landscape' &&
      targetHeight > targetWidth
    ) {
      [targetWidth, targetHeight] = [targetHeight, targetWidth];
    }

    // Helper to format color
    const formatColor = (hex: string | undefined) => {
      if (!hex) return 'white';
      // Ensure hex starts with 0x for FFmpeg if it's #RRGGBB
      if (hex.startsWith('#')) return hex.replace('#', '0x') + 'FF'; // Adding alpha
      return hex;
    };

    // Color with explicit opacity (for drawtext background boxes)
    const formatColorWithOpacity = (hex: string, opacity: number) => {
      const alpha = Math.round(Math.min(Math.max(opacity, 0), 1) * 255)
        .toString(16)
        .padStart(2, '0')
        .toUpperCase();
      if (hex.startsWith('#')) return hex.replace('#', '0x') + alpha;
      return `${hex}@${opacity}`;
    };

    // Escape literal text for the drawtext filter. The value is wrapped in
    // single quotes at the filtergraph level, which protects commas/spaces but
    // NOT colons (those still need a backslash). Percent is NOT escaped:
    // drawtext runs with expansion=none (we never use %{...} sequences), and
    // under the default expansion mode there is no working escape for a
    // literal % — both "\%" and "%%" log "Stray %" and silently blank the
    // entire cue. A literal ASCII apostrophe cannot be represented inside
    // that quoted context — every known escape either breaks filtergraph
    // parsing (crashing the render with "Filter not found") or silently drops
    // surrounding text — so we map it to the typographic apostrophe (U+2019),
    // which renders identically for caption/speech text and keeps the quoting
    // intact. Control characters are stripped: freetype has no glyph for them,
    // so drawtext renders each as a .notdef "tofu" box (□) — a stray CR from a
    // CRLF line ending is the classic case. Line breaks are handled upstream by
    // splitting into one drawtext per line (drawtext ≥ ffmpeg 8 also draws a
    // tofu for a bare LF), so no newline should ever reach here; the strip is a
    // final guard against any residual control byte.
    const escapeDrawtext = (text: string) =>
      text
        .replace(/[\u0000-\u001f\u007f]/g, '') // eslint-disable-line no-control-regex
        .replace(/\\/g, '\\\\')
        .replace(/'/g, '’')
        .replace(/:/g, '\\:');

    // Map caption placement presets to drawtext expressions
    const alignToX = (align?: 'left' | 'center' | 'right') => {
      if (align === 'left') return 'w*0.05';
      if (align === 'right') return 'w-text_w-w*0.05';
      return '(w-text_w)/2';
    };
    const positionToY = (position?: 'top' | 'middle' | 'bottom') => {
      if (position === 'top') return 'h*0.08';
      if (position === 'bottom') return 'h-text_h-h*0.08';
      return '(h-text_h)/2';
    };

    // Deterministic fonts. In production these point at fonts baked into the
    // image (see docker/Dockerfile); when unset (e.g. local macOS dev) we omit
    // fontfile and let fontconfig resolve a system font, preserving prior
    // behaviour. Building the fontfile clause once keeps every drawtext call
    // pinned to the same typeface.
    const regularFont = process.env.RENDER_FONT_FILE;
    const boldFont = process.env.RENDER_FONT_FILE_BOLD || regularFont;
    const escapeFontPath = (p: string) =>
      p.replace(/\\/g, '\\\\').replace(/:/g, '\\:');
    const fontFileArg = (bold: boolean) => {
      const file = bold ? boldFont : regularFont;
      return file ? `:fontfile='${escapeFontPath(file)}'` : '';
    };

    // Round time values to avoid floating-point precision issues (e.g. 18.599999999999998)
    // Composite clips with decimal segments can accumulate errors; millisecond precision is sufficient
    const fmtTime = (t: number): number => Math.round(t * 1000) / 1000;

    // Sort tracks by layer
    const sortedTracks = [...tracks].sort(
      (a, b) => (a.layer || 0) - (b.layer || 0)
    );

    let lastVideoLabel = '[base]';
    const audioInputs: string[] = [];

    // Create a base black background
    // Calculate total duration (use fmtTime to avoid floating-point accumulation from composite segments)
    let totalDuration = 0;
    for (const track of sortedTracks) {
      for (const seg of track.segments) {
        const end = fmtTime(seg.time.start + seg.time.duration);
        if (end > totalDuration) totalDuration = end;
      }
    }
    totalDuration = totalDuration || 1;
    if (options.totalDurationOverride !== undefined) {
      totalDuration = fmtTime(options.totalDurationOverride);
    }
    // The canvas is quantized to the same frame grid as the segments, so its
    // frame count always matches the furthest segment's end frame — no
    // trailing black flash-frame, no missing final slot.
    totalDuration = Math.max(1, frameOf(totalDuration)) / fps;

    // Sub-frame data gaps quantize away below; anything wider renders as
    // base-canvas black. A black hole narrower than the doctor's micro-gap
    // threshold (0.1s) is almost never editorial intent, so call it out —
    // this is the render-time counterpart of `vw timeline doctor`.
    if (options.mode !== 'audio-only') {
      for (const track of sortedTracks) {
        if (track.type === 'audio') continue;
        const frameWindows = track.segments
          .filter((seg) => seg.assetId && seg.type !== 'text')
          .map((seg) => ({
            id: seg.id,
            startFrame: frameOf(seg.time.start),
            endFrame: frameOf(seg.time.start + seg.time.duration),
          }))
          .sort((a, b) => a.startFrame - b.startFrame);
        for (let i = 1; i < frameWindows.length; i++) {
          const gapFrames =
            frameWindows[i].startFrame - frameWindows[i - 1].endFrame;
          if (gapFrames > 0 && gapFrames / fps < 0.1) {
            this.logger.warn(
              `Track ${track.id}: ${gapFrames}-frame black gap at ` +
                `${fmtSec(frameWindows[i - 1].endFrame / fps)}s between ` +
                `segments ${frameWindows[i - 1].id} and ${frameWindows[i].id}` +
                ` — likely an unintended micro-gap (see timeline doctor)`
            );
          }
        }
      }
    }

    // r= pins the canvas to the output fps explicitly (color defaults to
    // 25fps), matching the fps-normalized segment branches so framesync never
    // buffers waiting for off-grid timestamps.
    if (options.mode !== 'audio-only') {
      filterComplex.push(
        `color=c=black:s=${targetWidth}x${targetHeight}:r=${fps}:d=${fmtSec(totalDuration)}[base]`
      );
    }

    // Process Video/Image/Text Tracks
    for (const track of sortedTracks) {
      if (track.type === 'audio') {
        // Audio renders in its own pass in multi-pass mode; a video-only
        // window never opens audio inputs.
        if (options.mode === 'video-only') continue;
        // Audio handled separately
        for (const seg of track.segments) {
          if (!seg.assetId) continue;

          const clip = clipMediaMap[seg.assetId];
          if (!clip) {
            this.logger.warn(`Media not found for asset ID: ${seg.assetId}`);
            continue;
          }

          // Check if media has audio streams
          const hasAudio = !!(
            clip.media?.mediaData as unknown as { audio?: boolean }
          )?.audio;

          if (!hasAudio) {
            this.logger.debug(
              `Skipping audio for segment ${seg.id} as media ${seg.assetId} has no audio streams`
            );
            continue;
          }

          const sourceStart = fmtTime(seg.time.sourceStart || 0);
          const duration = fmtTime(seg.time.duration);
          const start = fmtTime(seg.time.start);
          const idx = addSeekedInput(clip.filePath, sourceStart, duration);

          // Delay: adelay is in milliseconds
          const delayMs = Math.round(start * 1000);

          // Filter: volume -> (fades) -> adelay. The input is already
          // seeked/limited to the segment window (-ss/-t), so no atrim is
          // needed; asetpts re-zeroes timestamps after the seek.
          const volume = seg.audio?.volume ?? 1.0;

          // Apply fades (100ms or half duration if short) to prevent clicks
          // Only apply if transitions are enabled (default true)
          const useTransitions = outputSettings.includeTransitions !== false;
          let audioFilter = `[${idx}:a]asetpts=PTS-STARTPTS,volume=${volume}`;

          if (useTransitions) {
            const fadeDuration = Math.min(0.1, duration / 2);
            const fadeOutStart = duration - fadeDuration;
            audioFilter += `,afade=t=in:st=0:d=${fadeDuration},afade=t=out:st=${fadeOutStart}:d=${fadeDuration}`;
          }

          audioFilter += `,adelay=${delayMs}|${delayMs}[${seg.id}_delayed]`;

          filterComplex.push(audioFilter);
          audioInputs.push(`[${seg.id}_delayed]`);
        }
        continue;
      }

      // The audio-only pass builds no visual graph at all — no canvas, no
      // decoders, no drawtext.
      if (options.mode === 'audio-only') continue;

      // Visual Tracks (Video, Image, Text)
      for (const seg of track.segments) {
        if (seg.type === 'text') {
          // Text is gated by kind so the two toggles are independent:
          //   - subtitles (auto speech-to-text) → includeSubtitles, default off
          //   - captions/titles (placed CaptionRef) → includeCaptions, default on
          // generateTracks already drops muted-track subtitles before this, so
          // any subtitle segment here reflects an enabled, unmuted track.
          const isSubtitle = seg.text?.role === 'subtitle';
          if (isSubtitle) {
            if (outputSettings.includeSubtitles !== true) continue;
          } else if (outputSettings.includeCaptions === false) {
            continue;
          }

          // Use drawtext on top of the current video chain
          const fontSize = seg.text?.fontSize || 24;
          const fontColor = formatColor(seg.text?.color);
          const x = seg.text?.x ?? alignToX(seg.text?.align);
          const y = seg.text?.y ?? positionToY(seg.text?.position);
          const fontArg = fontFileArg(seg.text?.bold ?? false);

          // Background box (e.g. subtitle banding)
          const hasBox = !!seg.text?.backgroundColor;
          let boxArgs = '';
          if (seg.text?.backgroundColor) {
            const boxColor = formatColorWithOpacity(
              seg.text.backgroundColor,
              seg.text.backgroundOpacity ?? 0.6
            );
            const boxBorder = Math.max(8, Math.round(fontSize / 4));
            boxArgs = `:box=1:boxcolor=${boxColor}:boxborderw=${boxBorder}`;
          }

          // Legibility + modern styling. An outline guarantees contrast on any
          // background (including white text on a white frame); a soft drop
          // shadow adds depth. Both scale with font size so captions (~48px)
          // and titles (~96px) stay balanced. A background box already
          // provides contrast, so the outline defaults off when a box is set.
          let styleArgs = '';
          if (seg.text?.outline ?? !hasBox) {
            const borderWidth = Math.max(2, Math.round(fontSize / 22));
            const borderColor = formatColorWithOpacity(
              seg.text?.outlineColor ?? '#000000',
              seg.text?.outlineOpacity ?? 0.9
            );
            styleArgs += `:borderw=${borderWidth}:bordercolor=${borderColor}`;
          }
          if (seg.text?.shadow ?? true) {
            const shadowOffset = Math.max(2, Math.round(fontSize / 18));
            const shadowColor = formatColorWithOpacity(
              seg.text?.shadowColor ?? '#000000',
              seg.text?.shadowOpacity ?? 0.5
            );
            styleArgs += `:shadowcolor=${shadowColor}:shadowx=${shadowOffset}:shadowy=${shadowOffset}`;
          }

          const segStart = fmtTime(seg.time.start);
          const segEnd = fmtTime(seg.time.start + seg.time.duration);

          // Animated captions emit one drawtext per cue; static text gets a
          // single drawtext covering the whole segment window.
          const cues = seg.text?.cues;
          const entries =
            cues && cues.length > 0
              ? cues.map((cue) => ({
                  text: cue.text,
                  start: Math.max(segStart, fmtTime(segStart + cue.start)),
                  end: Math.min(segEnd, fmtTime(segStart + cue.end)),
                }))
              : [
                  {
                    text: seg.text?.content || '',
                    start: segStart,
                    end: segEnd,
                  },
                ];

          // Line height for stacked multi-line text. Matches the editor
          // overlay's `leading-snug` (line-height 1.375) so preview and render
          // break lines at the same rhythm.
          const lineHeight = Math.round(fontSize * 1.375);

          // Vertical position of a given line in a multi-line block. drawtext
          // anchors each call at the top-left of its own text, so we place the
          // whole block using its total height (lines × lineHeight) and then
          // offset each line down by its index. A caller-supplied y is treated
          // as the block top; otherwise the position preset centres/pins the
          // block against the canvas (`h`).
          const yForLine = (lineIndex: number, lineCount: number) => {
            const offset = lineIndex * lineHeight;
            const custom = seg.text?.y;
            if (custom !== undefined) return `(${custom})+${offset}`;
            const blockH = lineCount * lineHeight;
            const position = seg.text?.position;
            if (position === 'top') return `h*0.08+${offset}`;
            if (position === 'bottom') return `h-${blockH}-h*0.08+${offset}`;
            return `(h-${blockH})/2+${offset}`;
          };

          entries.forEach((entry, cueIndex) => {
            if (!entry.text || entry.end <= entry.start) return;

            const enable = `between(t,${entry.start},${entry.end})`;

            // Split on any line-ending convention and render one drawtext per
            // line rather than passing a control character to drawtext. A raw
            // CR/LF has no glyph, so freetype draws it as a .notdef "tofu" box
            // (the reported "John Smith□New Beginnings"); CRLF yields two, and
            // drawtext ≥ ffmpeg 8 even boxes a bare LF. There is no usable \n
            // escape under expansion=none either. Per-line drawtext sidesteps
            // all of that and self-centres each line via the text_w-based x
            // expression — no `text_align` (ffmpeg ≥ 7.0 only) required.
            const lines = entry.text.split(/\r\n|\r|\n/);

            // Single-line text keeps the original y expression so existing
            // captions/subtitles render byte-for-byte as before.
            if (lines.length <= 1) {
              const nextLabel = `[v_txt_${seg.id}_${cueIndex}]`;
              filterComplex.push(
                `${lastVideoLabel}drawtext=expansion=none:text='${escapeDrawtext(entry.text)}'${fontArg}:fontsize=${fontSize}:fontcolor=${fontColor}:x=${x}:y=${y}${styleArgs}${boxArgs}:enable='${enable}'${nextLabel}`
              );
              lastVideoLabel = nextLabel;
              return;
            }

            lines.forEach((line, lineIndex) => {
              // Blank lines keep their vertical slot but draw nothing.
              if (!line) return;
              const nextLabel = `[v_txt_${seg.id}_${cueIndex}_${lineIndex}]`;
              filterComplex.push(
                `${lastVideoLabel}drawtext=expansion=none:text='${escapeDrawtext(line)}'${fontArg}:fontsize=${fontSize}:fontcolor=${fontColor}:x=${x}:y=${yForLine(lineIndex, lines.length)}${styleArgs}${boxArgs}:enable='${enable}'${nextLabel}`
              );
              lastVideoLabel = nextLabel;
            });
          });
          continue;
        }

        // For Video/Image
        if (!seg.assetId) continue;
        const clip = clipMediaMap[seg.assetId];
        if (!clip) {
          throw new Error(`Media not found for asset ID: ${seg.assetId}`);
        }

        // Quantize the segment to whole output frames (see frameOf above).
        // Segments that touch in ms-time share a frame boundary exactly, so
        // consecutive composite cuts tile with no uncovered slot. The source
        // in-point stays on the ms grid — WHICH content plays is an editorial
        // choice; only WHERE it lands snaps to the frame grid.
        const startFrame = frameOf(seg.time.start);
        const endFrame = frameOf(seg.time.start + seg.time.duration);
        if (endFrame <= startFrame) {
          // Shorter than half an output frame — nothing to show.
          this.logger.debug(
            `Skipping sub-frame segment ${seg.id} ` +
              `(${fmtSec(seg.time.duration)}s at ${fps}fps)`
          );
          continue;
        }
        const sourceStart = fmtTime(seg.time.sourceStart || 0);
        const duration = (endFrame - startFrame) / fps;
        const start = startFrame / fps;

        // Scale logic
        let scaleFilter = '';
        const targetW = seg.video?.width;
        const targetH = seg.video?.height;

        if (targetW || targetH) {
          scaleFilter = `,scale=${targetW || -1}:${targetH || -1}`;
        } else if (seg.type === 'video' || seg.type === 'image') {
          scaleFilter = `,scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2`;
        }

        // Branch chain: setpts shifts the (already seeked) window to its
        // timeline position; fps last so duplicated frames are cheap
        // references to already-scaled frames and land exactly on the base
        // canvas's output-fps grid.
        let idx: number;
        let branchPrefix = '';
        if (seg.type === 'image') {
          this.logger.debug(
            `Processing image segment ${seg.id}: duration=${duration}s`
          );
          const ext = path.extname(clip.filePath).toLowerCase();
          if (STATIC_IMAGE_EXTENSIONS.has(ext)) {
            idx = addImageInput(clip.filePath, duration);
          } else {
            // Demuxer can't loop this format — freeze the first frame with
            // the loop filter and bound it with trim, as before.
            idx = addPlainInput(clip.filePath);
            branchPrefix = `loop=loop=-1:size=1:start=0,trim=start=${fmtSec(sourceStart)}:duration=${fmtSec(duration)},`;
          }
        } else {
          idx = addSeekedInput(clip.filePath, sourceStart, duration);
        }

        filterComplex.push(
          `[${idx}:v]${branchPrefix}setpts=PTS-STARTPTS+${fmtSec(start)}/TB${scaleFilter},fps=${fps}[v_seg_${seg.id}]`
        );

        // Overlay. The enable window is expressed on HALF-FRAME offsets:
        // frame k of the base canvas has t = k/fps, so a window of
        // [(startFrame−0.5)/fps, (endFrame−0.5)/fps] enables exactly frames
        // startFrame … endFrame−1 — every boundary sits mid-interval, where
        // no frame timestamp (or its double-rounding noise) can ever land.
        // Adjacent segments share the boundary value, so each output frame
        // belongs to exactly one side of a cut.
        //
        // eof_action=repeat (not pass): a branch whose decoded frames run
        // out before its window closes — 24fps sources on a 30fps grid, VFR,
        // seek slop, media that physically ends early — holds its last frame
        // for the remaining slot(s) instead of dropping through to the black
        // canvas. This is what turns "occasional black flash at a cut" into
        // "at worst one held frame".
        const overlayLabel = `[v_over_${seg.id}]`;
        const xPos = seg.video?.x || 0;
        const yPos = seg.video?.y || 0;
        const enableFrom =
          startFrame === 0 ? '0' : fmtSec((startFrame - 0.5) / fps);
        const enableTo = fmtSec((endFrame - 0.5) / fps);
        const enable = `between(t,${enableFrom},${enableTo})`;

        filterComplex.push(
          `${lastVideoLabel}[v_seg_${seg.id}]overlay=x=${xPos}:y=${yPos}:enable='${enable}':eof_action=repeat${overlayLabel}`
        );
        lastVideoLabel = overlayLabel;
      }
    }

    // Mix Audio
    //
    // normalize=0 is critical: amix defaults normalize=1, which divides the
    // output by the number of currently-active inputs. Every segment is
    // adelay-padded with leading silence (real zero samples), so all clips count
    // as "active" from t=0 — the first clip would otherwise be divided by the
    // full clip count (e.g. ÷3 for 3 clips) while later clips get progressively
    // louder. With normalize off each clip plays at its intended level; the
    // alimiter then guards against clipping when audio genuinely overlaps.
    if (options.mode !== 'video-only') {
      if (audioInputs.length > 0) {
        filterComplex.push(
          `${audioInputs.join('')}amix=inputs=${audioInputs.length}:duration=longest:normalize=0,alimiter=limit=0.95[outa]`
        );
      } else {
        filterComplex.push(
          `anullsrc=channel_layout=stereo:sample_rate=44100:d=${fmtSec(totalDuration)}[outa]`
        );
      }
    }

    // Map Final Video
    // lastVideoLabel is the final output
    // We don't need null sink if we map lastVideoLabel directly.

    // Add filter complex
    args.push('-filter_complex', filterComplex.join('; '));

    // Map output streams
    if (options.mode === 'audio-only') {
      args.push('-map', '[outa]');
    } else if (options.mode === 'video-only') {
      args.push('-map', lastVideoLabel);
    } else {
      args.push('-map', lastVideoLabel, '-map', '[outa]');
    }

    if (options.mode !== 'audio-only') {
      // Add output settings
      args.push('-c:v', outputSettings.codec);

      // Add quality settings based on codec
      this.addQualitySettings(
        args,
        outputSettings.codec,
        targetWidth,
        targetHeight
      );

      // No -s here: the filtergraph already emits canvas-sized frames, and -s
      // would insert a redundant second scaler.
    }

    if (options.mode === 'video-only') {
      args.push('-video_track_timescale', String(partVideoTimescale(fps)));
    }

    if (options.mode !== 'video-only') {
      // Add audio codec with high quality settings (higher bitrate = larger files, better quality)
      args.push('-c:a', 'aac', '-b:a', '320k', '-ar', '48000');
    }

    // Add output format. Intermediate parts are always mp4 regardless of the
    // requested final container — only the concat pass writes that format.
    args.push('-f', options.mode === 'full' ? outputSettings.format : 'mp4');

    // Add output file
    args.push(outputPath);

    this.logger.debug(`FFmpeg command: ffmpeg ${args.join(' ')}`);
    return { args, totalDuration, inputCount: inputCounter };
  }

  /**
   * Add quality settings to FFmpeg args based on video codec
   */
  private addQualitySettings(
    args: string[],
    codec: string,
    width: number,
    height: number
  ): void {
    const codecLower = codec.toLowerCase();

    // Common quality settings for all codecs.
    // `slow` (not veryslow): at CRF-based quality the visual difference is
    // negligible, but veryslow's deep lookahead/reference buffers multiply
    // encoder RAM — a stability liability in memory-capped containers.
    args.push('-preset', 'slow');

    // Pixel format for compatibility (yuv420p works everywhere)
    args.push('-pix_fmt', 'yuv420p');

    if (codecLower === 'libx264' || codecLower === 'h264') {
      // H.264 quality settings
      // CRF 18: High quality (visually lossless, produces larger files)
      // Lower CRF = higher quality and larger file size
      args.push('-crf', '18');
      // Use high profile for better quality and compatibility
      args.push('-profile:v', 'high');
      // Set level based on resolution for compatibility
      if (width * height > 1920 * 1080) {
        args.push('-level', '4.2'); // 4K support
      } else {
        args.push('-level', '4.0'); // 1080p support
      }
      // Enable B-frames for better compression
      args.push('-bf', '2');
    } else if (
      codecLower === 'libx265' ||
      codecLower === 'h265' ||
      codecLower === 'hevc'
    ) {
      // H.265 quality settings
      // CRF 18: High quality (produces larger, higher quality files)
      // Lower CRF = higher quality and larger file size
      args.push('-crf', '18');
      // Use main profile
      args.push('-profile:v', 'main');
      // Set level based on resolution (use x265-params for level in libx265)
      if (width * height > 1920 * 1080) {
        args.push('-x265-params', 'level-idc=153:aq-mode=2:aq-strength=1.0'); // Level 5.1 for 4K
      } else {
        args.push('-x265-params', 'level-idc=120:aq-mode=2:aq-strength=1.0'); // Level 4.0 for 1080p
      }
    } else if (codecLower === 'libvpx-vp9' || codecLower === 'vp9') {
      // VP9 quality settings
      // VP9 uses -crf with range 0-63 (lower = better quality, larger files)
      // CRF 20: High quality setting for larger, higher quality output
      args.push('-crf', '20');
      // Set quality/speed tradeoff (0-9, lower = slower/better)
      args.push('-b:v', '0'); // Required for CRF mode in VP9
      args.push('-cpu-used', '1'); // 0-5, lower = better quality (1 for high quality)
    } else {
      // Fallback for unknown codecs - use CRF if codec supports it
      this.logger.warn(
        `Unknown codec "${codec}", using basic quality settings. Consider adding codec-specific optimizations.`
      );
    }
  }
}
