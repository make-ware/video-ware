import { z } from 'zod';
import {
  FilmstripConfig,
  ProbeOutputSchema,
  RenderTimelineConfig,
  SpriteConfig,
  TimelineTrack,
  TimelineSegment,
  WaveformConfig,
} from './task-contracts';
import { CropRectSchema } from './crop';
import { StorageBackendType, TimelineOrientation } from '../enums';

export const RenderTimelineConfigSchema = z.object({
  resolution: z.string(),
  codec: z.string(),
  format: z.string(),
  // Optional render flags consumed by the worker's compose step — must be
  // preserved (not stripped) when stored on a TimelineRender / task payload.
  fps: z.number().optional(),
  orientation: z.nativeEnum(TimelineOrientation).optional(),
  includeCaptions: z.boolean().optional(),
  includeSubtitles: z.boolean().optional(),
  includeTransitions: z.boolean().optional(),
}) satisfies z.ZodType<RenderTimelineConfig>;

const FilmstripConfigSchema = z.object({
  cols: z.number(),
  rows: z.number(),
  tileWidth: z.number(),
  tileHeight: z.number().optional(),
  // Per-segment fields written onto stored File meta (see FilmstripConfig).
  // Kept here so they survive schema validation instead of being stripped.
  segmentIndex: z.number().optional(),
  startTime: z.number().optional(),
  fps: z.number().optional(),
}) satisfies z.ZodType<FilmstripConfig>;

const WaveformConfigSchema = z.object({
  width: z.number(),
  height: z.number(),
  pixelsPerSecond: z.number().optional(),
  color: z.string().optional(),
  mono: z.boolean().optional(),
  // Per-chunk fields written onto stored File meta (see WaveformConfig).
  // Kept here so they survive schema validation instead of being stripped.
  chunkIndex: z.number().optional(),
  startTime: z.number().optional(),
  duration: z.number().optional(),
}) satisfies z.ZodType<WaveformConfig>;

const SpriteConfigSchema = z.object({
  fps: z.number(),
  cols: z.number(),
  rows: z.number(),
  tileWidth: z.number(),
  tileHeight: z.number(),
}) satisfies z.ZodType<SpriteConfig>;

/**
 * Measured facts about the *generated* asset — never a copy of the source
 * media's numbers. Every producer writes these from what it actually emitted
 * (the geometry handed to ffmpeg, or a probe of the finished output), so a
 * consumer can lay out a thumbnail/proxy/render without loading it first.
 *
 * All optional: which fields apply depends on the asset (a sprite sheet has
 * width/height but no duration; an extracted audio track has duration,
 * channels and sampleRate but no frame size), and records written before a
 * given field existed simply lack it.
 */
const FileMediaFactsSchema = z.object({
  /** Pixel width of the generated image/video (whole sheet for sprites). */
  width: z.number().optional(),
  /** Pixel height of the generated image/video (whole sheet for sprites). */
  height: z.number().optional(),
  /** Duration in seconds (time-based outputs only). */
  duration: z.number().optional(),
  /** Frames per second of the generated video. */
  fps: z.number().optional(),
  /** Codec of the generated stream (video codec, or audio for audio-only). */
  codec: z.string().optional(),
  /** Container bitrate in bits per second. */
  bitrate: z.number().optional(),
  /** Container format name as reported by ffprobe. */
  format: z.string().optional(),
  /** Size in bytes as reported by ffprobe. */
  size: z.number().optional(),
  /** Audio channel count (audio outputs). */
  channels: z.number().optional(),
  /** Audio sample rate in Hz (audio outputs). */
  sampleRate: z.number().optional(),
});

export const FileMetaSchema = z
  .object({
    renderSettings: RenderTimelineConfigSchema.optional(),
    filmstripConfig: FilmstripConfigSchema.optional(),
    spriteConfig: SpriteConfigSchema.optional(),
    waveformConfig: WaveformConfigSchema.optional(),
    mimeType: z.string(),
  })
  .extend(FileMediaFactsSchema.shape);

export type FileMetadata = z.infer<typeof FileMetaSchema>;

/**
 * `Media.mediaData` is the PROBE step's output stored verbatim, so the
 * persisted shape *is* ProbeOutput. This used to be a hand-maintained second
 * copy of that shape and had drifted (required fields the probe never sets,
 * `sampleRate` typed as a string, `video` sub-fields required that ffprobe
 * routinely omits); the alias makes drift impossible. Field-level notes about
 * what is optional and why live on ProbeOutputSchema.
 */
export const MediaMetadataSchema = ProbeOutputSchema;

export type MediaMetadata = z.infer<typeof MediaMetadataSchema>;

export const MediaClipMetadataSchema = z.object({
  confidence: z.number().optional(),
  labelType: z.string().optional(),
  rank: z.number().optional(),
  score: z.number().optional(),
  sourceId: z.string().optional(),
  sourceType: z.string().optional(),
  strategy: z.string().optional(),
  gapThreshold: z.number().optional(),
  segments: z
    .array(z.object({ start: z.number(), end: z.number() }))
    .optional(),
});

// ============================================================================
// Upload Metadata
// ============================================================================

// What a finalized Upload records about where its bytes landed. Deliberately
// NOT the runtime `StorageConfig`: credentials must never be persisted, so
// this is a flat, descriptive subset — the shape both finalize paths (the
// webapp's chunked upload route and the worker's watch-folder import) write.
export const UploadMetadataSchema = z.object({
  type: z.enum(StorageBackendType),
  bucket: z.string().optional(),
  region: z.string().optional(),
  endpoint: z.string().optional(),
});

export type UploadMetadata = z.infer<typeof UploadMetadataSchema>;

// ============================================================================
// Task Metadata
// ============================================================================

// Detection toggles for label jobs. `.passthrough()` so a newly added detector
// flag is never silently stripped before it reaches the worker's flow builder
// (the real gate) — the class of bug where a new step is enqueued but dropped
// at task-creation validation. Keep the explicit fields in sync with
// DetectLabelsConfig; the canonical "enable all" values live in
// ALL_LABEL_DETECTIONS (task-contracts.ts).
const LabelsDetectionConfigSchema = z
  .object({
    confidenceThreshold: z.number().optional(),
    detectObjects: z.boolean().optional(),
    detectLabels: z.boolean().optional(),
    detectFaces: z.boolean().optional(),
    detectPersons: z.boolean().optional(),
    detectText: z.boolean().optional(),
    detectSpeech: z.boolean().optional(),
    detectSpeakers: z.boolean().optional(),
  })
  .passthrough();

// Task payload schemas (union based on task type)
export const TaskPayloadSchema = z.union([
  // ProcessUploadPayload
  z.object({
    uploadId: z.string(),
    mediaId: z.string(),
    provider: z.string().optional(),
    labels: LabelsDetectionConfigSchema.optional(),
    sprite: SpriteConfigSchema.optional(),
    filmstrip: FilmstripConfigSchema.optional(),
    waveform: WaveformConfigSchema.optional(),
    thumbnail: z
      .object({
        timestamp: z.union([z.number(), z.literal('midpoint')]),
        width: z.number(),
        height: z.number(),
      })
      .optional(),
    transcode: z
      .object({
        enabled: z.boolean(),
        codec: z.enum(['h264', 'h265', 'vp9']),
        resolution: z.enum(['720p', '1080p', 'original']),
        bitrate: z.number().optional(),
      })
      .optional(),
    audio: z
      .object({
        enabled: z.boolean(),
        format: z.enum(['mp3', 'aac', 'wav']).optional(),
        bitrate: z.string().optional(),
        channels: z.number().optional(),
        sampleRate: z.number().optional(),
      })
      .optional(),
  }),
  // DetectLabelsPayload
  z.object({
    mediaId: z.string(),
    fileRef: z.string(),
    provider: z.string(),
    config: LabelsDetectionConfigSchema,
  }),
  // RenderTimelinePayload
  z.object({
    timelineId: z.string(),
    version: z.number(),
    tracks: z.array(z.any()), // TimelineTrack[] - validated separately
    outputSettings: RenderTimelineConfigSchema,
    provider: z.string().optional(),
  }),
  // Generic fallback for unknown task types
  z.record(z.string(), z.unknown()),
]);

// Task result schemas (union based on task type)
export const TaskResultSchema = z.union([
  // ProcessUploadResult
  z.object({
    mediaId: z.string(),
    thumbnailFileId: z.string().optional(),
    spriteFileId: z.string().optional(),
    filmstripFileId: z.string().optional(),
    proxyFileId: z.string().optional(),
    processorVersion: z.string().optional(),
    probeOutput: ProbeOutputSchema.optional(),
  }),
  // DetectLabelsResult
  z.object({
    labelsFileId: z.string().optional(),
    summary: z.object({
      labelCount: z.number(),
      objectCount: z.number(),
    }),
    processorVersion: z.string(),
  }),
  // RenderTimelineResult
  z.object({
    mediaId: z.string(),
    fileId: z.string(),
    processorVersion: z.string(),
  }),
  // CleanupResult — counts emitted by the `cleanup` task. Results written
  // before the unreferenced-files sweep existed lack that count, so it stays
  // optional here (the fallback record catches them anyway).
  z.object({
    refsLinked: z.number(),
    staleFilesPruned: z.number(),
    unreferencedFilesPruned: z.number().optional(),
    artifactsDeleted: z.number(),
    artifactsFailed: z.number(),
    localDirsPurged: z.number(),
    tempDirsRemoved: z.number(),
  }),
  // Generic fallback for unknown task types
  z.record(z.string(), z.unknown()),
]);

// CleanupResult — typed shape of the cleanup task's result payload.
export interface CleanupResult {
  refsLinked: number;
  staleFilesPruned: number;
  unreferencedFilesPruned: number;
  artifactsDeleted: number;
  artifactsFailed: number;
  localDirsPurged: number;
  tempDirsRemoved: number;
}

// ============================================================================
// Timeline Metadata
// ============================================================================

const TimelineSegmentSchema = z.object({
  id: z.string(),
  assetId: z.string().optional(),
  type: z.enum(['video', 'audio', 'text', 'image']),
  time: z.object({
    start: z.number(),
    duration: z.number(),
    sourceStart: z.number().optional(),
  }),
  video: z
    .object({
      x: z.union([z.number(), z.string()]).optional(),
      y: z.union([z.number(), z.string()]).optional(),
      width: z.union([z.number(), z.string()]).optional(),
      height: z.union([z.number(), z.string()]).optional(),
      opacity: z.number().optional(),
      // Must stay in lockstep with TimelineSegment.video.crop: this schema
      // validates TimelineRenders.timelineData on create and STRIPS keys it
      // doesn't declare — `satisfies z.ZodType<TimelineSegment>` cannot
      // catch a forgotten optional key.
      crop: CropRectSchema.optional(),
    })
    .optional(),
  audio: z
    .object({
      volume: z.number().optional(),
    })
    .optional(),
  text: z
    .object({
      content: z.string(),
      role: z.enum(['subtitle', 'caption', 'title']).optional(),
      cues: z
        .array(
          z.object({
            text: z.string(),
            start: z.number(),
            end: z.number(),
          })
        )
        .optional(),
      fontSize: z.number().optional(),
      color: z.string().optional(),
      backgroundColor: z.string().optional(),
      backgroundOpacity: z.number().optional(),
      position: z.enum(['top', 'middle', 'bottom']).optional(),
      align: z.enum(['left', 'center', 'right']).optional(),
      x: z.union([z.number(), z.string()]).optional(),
      y: z.union([z.number(), z.string()]).optional(),
    })
    .optional(),
}) satisfies z.ZodType<TimelineSegment>;

const TimelineTrackSchema = z.object({
  id: z.string(),
  type: z.enum(['video', 'audio', 'text', 'overlay']),
  layer: z.number().optional(),
  segments: z.array(TimelineSegmentSchema),
}) satisfies z.ZodType<TimelineTrack>;

export const TimelineMetadataSchema = z.array(TimelineTrackSchema);

// ============================================================================
// TimelineClip Metadata
// ============================================================================

export const TimelineClipMetadataSchema = z.object({
  title: z.string().optional(),
  color: z.string().optional(), // hex color e.g. #FFFFFF
  segments: z
    .array(z.object({ start: z.number(), end: z.number() }))
    .optional(),
  mediaMissing: z.boolean().optional(), // set when source media is deleted
  gain: z.number().min(0).max(1).optional(), // per-clip audio gain, 0.0–1.0 (default 1.0)
  // Nested-timeline clips only: window follows the source timeline's live
  // duration (untrimmed). Cleared when the user trims away from full span.
  followSource: z.boolean().optional(),
  // Set by reflow when a trimmed window fell wholly beyond a shrunk source
  // and was clamped to its tail; cleared on the next successful user trim.
  sourceOutOfRange: z.boolean().optional(),
  // Per-clip source crop (reframe). Absolute display-space rect — NOT
  // relative to the media's default crop. Delete the key to reset to the
  // default (media crop, else full frame). Media-backed clips only.
  crop: CropRectSchema.optional(),
});

// ============================================================================
// TimelineRender Metadata
// ============================================================================

// TimelineRender doesn't have a metadata field in the schema,
// but we can define a schema for any future metadata needs
export const TimelineRenderMetadataSchema = z.object({});
