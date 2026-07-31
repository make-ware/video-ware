import { z } from 'zod';
import type { ProcessingProvider, TimelineOrientation } from '../enums.js';
import type { CropRect } from './crop.js';

// ============================================================================
// Task Payload and Result Contracts
// ============================================================================

/**
 * Configuration for sprite sheet generation.
 *
 * As a *request* this is advisory: the generator always scales tiles to the
 * source's display aspect ratio, so a requested `tileHeight` that disagrees
 * with it is overridden rather than obeyed (forcing it would stretch the
 * frames). As stored File `meta.spriteConfig` it is a *record* of the geometry
 * the sheet was actually built with — read it there, never the request.
 */
export interface SpriteConfig {
  /** Frames per second to sample (e.g., 1 for one frame per second) */
  fps: number;
  /** Number of columns in the sprite sheet */
  cols: number;
  /** Number of rows in the sprite sheet */
  rows: number;
  /** Width of each tile in pixels */
  tileWidth: number;
  /** Height of each tile in pixels */
  tileHeight: number;
}

/**
 * Configuration for filmstrip generation. Same request-vs-record split as
 * SpriteConfig: `tileHeight` in a request is a hint, and the value stored on a
 * segment's File `meta.filmstripConfig` is what the strip really contains.
 */
export interface FilmstripConfig {
  /** Number of columns in the filmstrip (e.g., 100) */
  cols: number;
  /** Number of rows in the filmstrip (e.g., 1) */
  rows: number;
  /** Width of each tile in pixels */
  tileWidth: number;
  /** Height of each tile in pixels — derived from the source display aspect
   * when it can be (see the interface note); only used verbatim when the
   * source dimensions are unknown. */
  tileHeight?: number;
  /**
   * The following fields are not part of the generation *input* — they are
   * populated by the worker onto each segment's stored File `meta` so the
   * viewer can map a playback time to the correct tile. Optional because the
   * input config does not provide them.
   */
  /** Index of this segment within the media (0-based) */
  segmentIndex?: number;
  /** Absolute media time (seconds) at which this segment's first tile begins */
  startTime?: number;
  /** Frames sampled per second into the strip (currently always 1) */
  fps?: number;
}

/**
 * Configuration for audio waveform generation.
 *
 * Same request-vs-record split as SpriteConfig/FilmstripConfig. As a *request*
 * it describes one full-width chunk: `width` px drawn at `pixelsPerSecond`, so
 * `width / pixelsPerSecond` seconds of audio per image. As stored File
 * `meta.waveformConfig` it records what a single chunk actually contains —
 * the trailing chunk is narrower (or, when the tail is tiny, the previous one
 * is wider), so `width`/`startTime`/`duration` there are per-image facts, not
 * the request. See planWaveformChunks in shared/src/utils/waveform.ts.
 */
export interface WaveformConfig {
  /** Pixel width of a full chunk (the last one may differ) */
  width: number;
  /** Pixel height of every chunk image */
  height: number;
  /**
   * Horizontal resolution: pixels drawn per second of audio. ~1 keeps a long
   * file readable; raising it makes chunks cover proportionally less time.
   */
  pixelsPerSecond?: number;
  /** Waveform color — any ffmpeg color name or `#rrggbb` (default: white) */
  color?: string;
  /**
   * Downmix to a single waveform instead of drawing one curve per channel
   * (default: true).
   */
  mono?: boolean;
  /**
   * The following fields are not generation *input* — the worker writes them
   * onto each chunk's File `meta` so a consumer can lay chunks end to end and
   * map a playback time into one. Optional because a request never sets them.
   */
  /** Index of this chunk within the media (0-based) */
  chunkIndex?: number;
  /** Absolute media time (seconds) where this chunk's first pixel begins */
  startTime?: number;
  /** Seconds of audio this chunk covers */
  duration?: number;
}

/**
 * Configuration for thumbnail generation
 */
export interface ThumbnailConfig {
  /** Timestamp in seconds or 'midpoint' for middle of video */
  timestamp: number | 'midpoint';
  /** Width of thumbnail in pixels */
  width: number;
  /** Height of thumbnail in pixels */
  height: number;
}

/**
 * Configuration for video transcoding (optional proxy generation)
 */
export interface TranscodeConfig {
  /** Whether transcoding is enabled */
  enabled: boolean;
  /** Video codec to use */
  codec: 'h264' | 'h265' | 'vp9';
  /** Target resolution */
  resolution: '720p' | '1080p' | 'original';
  /** Target bitrate in bits per second (optional) */
  bitrate?: number;
}

/**
 * Payload for process_upload task
 * Contains all configuration needed to process an uploaded media file
 */
export interface ProcessUploadPayload {
  /** ID of the Upload record being processed */
  uploadId: string;
  /** ID of the Media record to update */
  mediaId: string;
  /** Processing provider to use (FFmpeg, Google Cloud, etc.) */
  provider?: ProcessingProvider;
  /** Optional label detection configuration to enqueue after transcode */
  labels?: DetectLabelsConfig;
  /** Configuration for sprite sheet generation */
  sprite?: SpriteConfig;
  /** Configuration for filmstrip generation */
  filmstrip?: FilmstripConfig;
  /** Configuration for audio waveform generation */
  waveform?: WaveformConfig;
  /** Configuration for thumbnail generation */
  thumbnail?: ThumbnailConfig;
  /** Optional configuration for transcoding/proxy generation */
  transcode?: TranscodeConfig;
  /** Optional configuration for audio extraction */
  audio?: AudioConfig;
  /** Optional configuration for ffmpeg cropdetect autocrop */
  autocrop?: AutoCropConfig;
}

/**
 * Configuration for the AUTOCROP step — ffmpeg `cropdetect` over a handful of
 * sample windows, aggregated into a recommendation stored on
 * `Media.cropSuggestion` and (when it clears the thresholds and the detector
 * owns the column) applied to `Media.crop`.
 *
 * The crop is applied at FLATTEN time by the renderer, so it deliberately does
 * NOT change the proxy or any generated derivative — cropping the proxy too
 * would apply the same trim twice.
 */
export interface AutoCropConfig {
  /** Whether crop detection is enabled */
  enabled: boolean;
  /** cropdetect black threshold, 0–255 (ffmpeg default 24) */
  limit?: number;
  /** Number of sample windows spread across the media (default 5) */
  samples?: number;
  /** Seconds of video analysed per sample window (default 2) */
  sampleDuration?: number;
  /** Frames analysed per second within a sample window (default 2) */
  sampleFps?: number;
  /** Minimum fraction of a side that must be trimmed to apply (default 0.015) */
  minTrimFraction?: number;
  /** Reject detections covering less of the frame than this (default 0.25) */
  minAreaFraction?: number;
}

/**
 * Configuration for audio extraction
 */
export interface AudioConfig {
  /** Whether audio extraction is enabled */
  enabled: boolean;
  /** Audio format (mp3, aac, wav) */
  format?: 'mp3' | 'aac' | 'wav';
  /** Audio bitrate (e.g., '192k', '256k') */
  bitrate?: string;
  /** Number of audio channels (1 for mono, 2 for stereo) */
  channels?: number;
  /** Audio sample rate (e.g., 44100, 48000) */
  sampleRate?: number;
}

/**
 * Output from media probing (ffprobe or equivalent).
 *
 * This is also the persisted shape of `Media.mediaData`: the PROBE step writes
 * its output there verbatim, so `MediaMetadataSchema` (types/metadata.ts) is
 * this schema rather than a hand-kept parallel copy — the two drifted apart
 * before, and the mismatch only surfaced as a type error at the one place they
 * met.
 *
 * Because it describes stored records as well as fresh probe output, a field is
 * optional here if *either* ffprobe can omit it *or* older rows predate it.
 * Reads are not re-validated (see BaseMutator), so this schema is a promise
 * about what is really in the column — keep it honest.
 */
export const ProbeOutputSchema = z.object({
  /** Duration in seconds */
  duration: z.number(),
  /** Video width in pixels (raw encoded dimensions); 0 for audio-only input */
  width: z.number(),
  /** Video height in pixels (raw encoded dimensions); 0 for audio-only input */
  height: z.number(),
  /**
   * Display dimensions after applying rotation. Optional: rows probed before
   * rotation handling existed have neither.
   */
  displayWidth: z.number().optional(),
  displayHeight: z.number().optional(),
  /** Rotation in degrees (0, 90, 180, 270) */
  rotation: z.number().optional(),
  /** Video codec (e.g., 'h264', 'vp9'), or the audio codec for audio-only */
  codec: z.string(),
  /** Frames per second; 0 for audio-only input */
  fps: z.number(),
  /** Container bitrate in bits per second — ffprobe omits it for some formats */
  bitrate: z.number().optional(),
  /** Container format name */
  format: z.string(),
  /** File size in bytes — ffprobe omits it for some inputs */
  size: z.number().optional(),
  /**
   * Creation date from container/stream metadata as an ISO-8601 string.
   * Absent when the file carries no usable date tag. A string, not a Date:
   * this rides through JSON into `Media.mediaData`, where a Date would arrive
   * back as a string anyway.
   */
  mediaDate: z.string().optional(),
  /** Video stream details; absent for audio-only media */
  video: z
    .object({
      codec: z.string(),
      width: z.number(),
      height: z.number(),
      profile: z.string().optional(),
      aspectRatio: z.string().optional(),
      pixFmt: z.string().optional(),
      level: z.string().optional(),
      colorSpace: z.string().optional(),
      /** Rotation in degrees from metadata */
      rotation: z.number().optional(),
    })
    .optional(),
  /** Audio stream details; absent for silent media */
  audio: z
    .object({
      codec: z.string(),
      channels: z.number(),
      /** Sample rate in Hz. ffprobe reports it as a string; the probe
       * executor coerces, so rows written before that carry a string here. */
      sampleRate: z.number(),
      bitrate: z.number().optional(),
    })
    .optional(),
});

export type ProbeOutput = z.infer<typeof ProbeOutputSchema>;

/**
 * Configuration for label/object detection
 */
export interface DetectLabelsConfig {
  /** Confidence threshold for detection (0.0 to 1.0) */
  confidenceThreshold?: number;
  /** Whether to detect objects (bounding boxes) */
  detectObjects?: boolean;
  /** Whether to detect labels (shot/segment level) */
  detectLabels?: boolean;
  /** Whether to detect faces */
  detectFaces?: boolean;
  /** Whether to detect persons */
  detectPersons?: boolean;
  /** Whether to detect on-screen text (OCR) */
  detectText?: boolean;
  /** Whether to detect speech */
  detectSpeech?: boolean;
  /** Whether to transcribe speech with speaker diarization (ElevenLabs) */
  detectSpeakers?: boolean;
}

/**
 * Canonical "run every detector" config used by the full-detection callers:
 * the webapp "Detect Labels" button (services/media.ts) and the worker ingest
 * orchestrator. Typed as `Required` so that adding a new detection toggle to
 * DetectLabelsConfig breaks the build here until it is set — guaranteeing new
 * steps are enqueued automatically instead of being silently skipped.
 *
 * These flags are an *intent* layer only. LabelsFlowBuilder gates each step by
 * `ENABLE_* env AND this config`, so a deployment's env flags decide what
 * actually runs; enabling everything here can never force a disabled step on.
 */
export const ALL_LABEL_DETECTIONS: Required<
  Omit<DetectLabelsConfig, 'confidenceThreshold'>
> = {
  detectObjects: true,
  detectLabels: true,
  detectFaces: true,
  detectPersons: true,
  detectText: true,
  detectSpeech: true,
  detectSpeakers: true,
};

/**
 * Payload for detect_labels task
 */
export interface DetectLabelsPayload {
  /** ID of the Media record to analyze */
  mediaId: string;
  /** Reference to the file to analyze */
  fileRef: string;
  /** Processing provider to use */
  provider: ProcessingProvider;
  /** Configuration for detection */
  config: DetectLabelsConfig;
}

/**
 * Result from detect_labels task
 */
export interface DetectLabelsResult {
  /** ID of the JSON file containing detailed labels (if saved to GCS/S3) */
  labelsFileId?: string;
  /** Summary of detected labels/objects */
  summary: {
    labelCount: number;
    objectCount: number;
  };
  /** Version identifier of the processor */
  processorVersion: string;
}

/**
 * Result from process_upload task
 * Contains references to all generated assets and metadata
 */
export interface ProcessUploadResult {
  /** ID of the created Media record */
  mediaId: string;
  /** ID of the thumbnail File record */
  thumbnailFileId?: string;
  /** ID of the sprite sheet File record */
  spriteFileId?: string;
  /** ID of the filmstrip File record */
  filmstripFileId?: string;
  /** ID of the proxy/transcoded File record (if transcoding was enabled) */
  proxyFileId?: string;
  /** Version identifier of the processor that executed the task (e.g., "ffmpeg:7.0.1") */
  processorVersion?: string;
  /** Metadata extracted from the media file */
  probeOutput?: ProbeOutput;
}

/**
 * Configuration for timeline rendering output
 */
export interface RenderTimelineConfig {
  /** Output codec */
  codec: string;
  /** Output container format */
  format: string;
  /** Output resolution (e.g., '1920x1080') */
  resolution: string;
  /**
   * Output frame rate. The renderer quantizes every cut to this frame grid,
   * so it is the single authority on where a cut can land (default 30).
   * Integer rates only (e.g. 24, 25, 30, 60).
   */
  fps?: number;
  /** Output orientation; when set, target dimensions are normalized to match */
  orientation?: TimelineOrientation;
  /**
   * Whether to burn in caption/title clips (deliberately placed CaptionRef
   * text) in the output. Default true.
   */
  includeCaptions?: boolean;
  /**
   * Whether to burn in auto subtitles derived from each clip's speech
   * transcript (LabelSpeech). Muted tracks never contribute subtitles.
   * Default false.
   */
  includeSubtitles?: boolean;
  /** Whether to include transitions in the output */
  includeTransitions?: boolean;
}

/**
 * Represents a single segment in a timeline track
 */
export interface TimelineSegment {
  /** Unique identifier for the segment */
  id: string;
  /** ID of the media asset (required for video/audio/image) */
  assetId?: string;
  /** Type of content */
  type: 'video' | 'audio' | 'text' | 'image';
  /** Timing information */
  time: {
    /** Start time on the timeline in seconds */
    start: number;
    /** Duration in seconds */
    duration: number;
    /** Start time in the source media in seconds */
    sourceStart?: number;
  };
  /** Video specific properties */
  video?: {
    x?: number | string; // pixels or percentage string e.g. "10%"
    y?: number | string;
    width?: number | string;
    height?: number | string;
    opacity?: number; // 0.0 to 1.0
    /**
     * Source crop, 0–1 fractions of the media's DISPLAY frame
     * (post-rotation). Resolved at flatten time (clip crop ?? media crop —
     * see resolveCropRect); the renderer crops BEFORE scaling so the
     * letterbox/PiP scaler fits the cropped region. Absent = full frame.
     */
    crop?: CropRect;
  };
  /** Audio specific properties */
  audio?: {
    volume?: number; // 1.0 is 100%
  };
  /** Text specific properties */
  text?: {
    content: string;
    /**
     * What kind of text this is, so the renderer can gate it independently:
     * `subtitle` = auto speech-to-text (gated by includeSubtitles), while
     * `caption`/`title` = deliberately placed CaptionRef clips (gated by
     * includeCaptions). Absent is treated as a non-subtitle caption.
     */
    role?: 'subtitle' | 'caption' | 'title';
    /**
     * Timed text changes (animated captions). Cue times are in seconds
     * relative to the segment start. When present, each cue's text is
     * shown only during its window; `content` is the static fallback.
     */
    cues?: Array<{ text: string; start: number; end: number }>;
    fontSize?: number;
    color?: string; // hex color e.g. #FFFFFF
    backgroundColor?: string; // hex color for a background box
    backgroundOpacity?: number; // 0.0 to 1.0, default 0.6 when box is set
    position?: 'top' | 'middle' | 'bottom'; // vertical placement preset
    align?: 'left' | 'center' | 'right'; // horizontal alignment preset
    bold?: boolean; // use the bold font variant (titles); default false
    shadow?: boolean; // drop shadow behind text; default true
    shadowColor?: string; // hex color for the shadow; default #000000
    shadowOpacity?: number; // 0.0 to 1.0; default 0.5
    outline?: boolean; // text outline; default true unless a box is set
    outlineColor?: string; // hex color for the outline; default #000000
    outlineOpacity?: number; // 0.0 to 1.0; default 0.9
    x?: number | string;
    y?: number | string;
  };
}

/**
 * Represents a track in the timeline containing multiple segments
 */
export interface TimelineTrack {
  /** Unique identifier for the track */
  id: string;
  /** Type of track */
  type: 'video' | 'audio' | 'text' | 'overlay';
  /** Order/Layer index (lower is background, higher is foreground) */
  layer?: number;
  /** List of segments in this track */
  segments: TimelineSegment[];
}

/**
 * Payload for render_timeline task
 */
export interface RenderTimelinePayload {
  /** ID of the Timeline record */
  timelineId: string;
  /** ID of the TimelineRender record the worker updates (FileRef/status) */
  timelineRenderId?: string;
  /** Version of the timeline */
  version: number;
  /** List of tracks defining the timeline composition */
  tracks: TimelineTrack[];
  /** Output settings */
  outputSettings: RenderTimelineConfig;
  /** Processing provider */
  provider?: ProcessingProvider;
}

/**
 * Result from render_timeline task
 */
export interface RenderTimelineResult {
  /** ID of the created Media record for the rendered timeline */
  mediaId: string;
  /** ID of the generated File record */
  fileId: string;
  /** Version of the processor used */
  processorVersion: string;
}

/**
 * Payload for full_ingest task (combined transcode + labels)
 */
export interface FullIngestPayload {
  /** ID of the Upload record */
  uploadId: string;
  /** Configuration for transcode/proxy */
  transcode?: TranscodeConfig;
  /** Configuration for sprite sheet */
  sprite?: SpriteConfig;
  /** Configuration for filmstrip */
  filmstrip?: FilmstripConfig;
  /** Configuration for thumbnail */
  thumbnail?: ThumbnailConfig;
  /** Configuration for label detection */
  labels?: DetectLabelsConfig;
  /** Processing provider */
  provider?: ProcessingProvider;
}
