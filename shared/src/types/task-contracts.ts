import type { ProcessingProvider, TimelineOrientation } from '../enums.js';

// ============================================================================
// Task Payload and Result Contracts
// ============================================================================

/**
 * Configuration for sprite sheet generation
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
 * Configuration for filmstrip generation
 */
export interface FilmstripConfig {
  /** Number of columns in the filmstrip (e.g., 100) */
  cols: number;
  /** Number of rows in the filmstrip (e.g., 1) */
  rows: number;
  /** Width of each tile in pixels */
  tileWidth: number;
  /** Height of each tile in pixels (optional, will be calculated from aspect ratio if not provided) */
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
  /** Configuration for thumbnail generation */
  thumbnail?: ThumbnailConfig;
  /** Optional configuration for transcoding/proxy generation */
  transcode?: TranscodeConfig;
  /** Optional configuration for audio extraction */
  audio?: AudioConfig;
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
 * Output from media probing (ffprobe or equivalent)
 */
export interface ProbeOutput {
  /** Duration in seconds */
  duration: number;
  /** Video width in pixels (raw encoded dimensions) */
  width: number;
  /** Video height in pixels (raw encoded dimensions) */
  height: number;
  /** Display width after applying rotation */
  displayWidth: number;
  /** Display height after applying rotation */
  displayHeight: number;
  /** Rotation in degrees (0, 90, 180, 270) */
  rotation: number;
  /** Video codec (e.g., 'h264', 'vp9') */
  codec: string;
  /** Frames per second */
  fps: number;
  /** Bitrate in bits per second (optional) */
  bitrate?: number;
  /** Container format name */
  format?: string;
  /** File size in bytes */
  size?: number;
  /** Media date from metadata or file system (optional) */
  mediaDate?: Date;
  /** Video stream details */
  video?: {
    codec: string;
    profile?: string;
    width: number;
    height: number;
    aspectRatio?: string;
    pixFmt?: string;
    level?: string;
    colorSpace?: string;
    /** Rotation in degrees from metadata */
    rotation?: number;
  };
  /** Audio stream details (if present) */
  audio?: {
    codec: string;
    channels: number;
    sampleRate: number;
    bitrate?: number;
  };
}

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
