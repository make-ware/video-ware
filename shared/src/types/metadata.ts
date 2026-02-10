import { z } from 'zod';
import {
  FilmstripConfig,
  RenderTimelineConfig,
  SpriteConfig,
  TimelineTrack,
  TimelineSegment,
} from './task-contracts';
import { StorageBackendType } from '../enums';
import type { StorageConfig } from '../storage/types';

const RenderTimelineConfigSchema = z.object({
  resolution: z.string(),
  codec: z.string(),
  format: z.string(),
}) satisfies z.ZodType<RenderTimelineConfig>;

const FilmstripConfigSchema = z.object({
  cols: z.number(),
  rows: z.number(),
  tileWidth: z.number(),
  tileHeight: z.number().optional(),
}) satisfies z.ZodType<FilmstripConfig>;

const SpriteConfigSchema = z.object({
  fps: z.number(),
  cols: z.number(),
  rows: z.number(),
  tileWidth: z.number(),
  tileHeight: z.number(),
}) satisfies z.ZodType<SpriteConfig>;

export const FileMetaSchema = z.object({
  renderSettings: RenderTimelineConfigSchema.optional(),
  filmstripConfig: FilmstripConfigSchema.optional(),
  spriteConfig: SpriteConfigSchema.optional(),
  mimeType: z.string(),
});

export type FileMetadata = z.infer<typeof FileMetaSchema>;

export const MediaMetadataSchema = z.object({
  audio: z.object({
    bitrate: z.number(),
    channels: z.number(),
    codec: z.string(),
    sampleRate: z.string(),
  }),
  bitrate: z.number(),
  codec: z.string(),
  duration: z.number(),
  format: z.string(),
  fps: z.number(),
  height: z.number(),
  displayWidth: z.number().optional(),
  displayHeight: z.number().optional(),
  rotation: z.number().optional(),
  mediaDate: z.string(),
  size: z.number(),
  video: z.object({
    codec: z.string(),
    colorSpace: z.string(),
    height: z.number(),
    level: z.string(),
    pixFmt: z.string(),
    profile: z.string(),
    width: z.number(),
    rotation: z.number().optional(),
  }),
  width: z.number(),
});

export const MediaClipMetadataSchema = z.object({
  labelType: z.string().optional(),
  rank: z.number().optional(),
  score: z.number().optional(),
  sourceId: z.string().optional(),
  sourceType: z.string().optional(),
  strategy: z.string().optional(),
  segments: z
    .array(z.object({ start: z.number(), end: z.number() }))
    .optional(),
});

// ============================================================================
// Upload Metadata
// ============================================================================

const LocalStorageConfigSchema = z.object({
  basePath: z.string(),
});

const S3StorageConfigSchema = z.object({
  endpoint: z.string(),
  bucket: z.string(),
  region: z.string(),
  accessKeyId: z.string(),
  secretAccessKey: z.string(),
  forcePathStyle: z.boolean().optional(),
});

export const UploadMetadataSchema = z.object({
  type: z.enum(StorageBackendType),
  local: LocalStorageConfigSchema.optional(),
  s3: S3StorageConfigSchema.optional(),
}) satisfies z.ZodType<StorageConfig>;

// ============================================================================
// Task Metadata
// ============================================================================

// Task payload schemas (union based on task type)
export const TaskPayloadSchema = z.union([
  // ProcessUploadPayload
  z.object({
    uploadId: z.string(),
    mediaId: z.string(),
    provider: z.string().optional(),
    labels: z
      .object({
        confidenceThreshold: z.number().optional(),
        detectObjects: z.boolean().optional(),
        detectLabels: z.boolean().optional(),
        detectFaces: z.boolean().optional(),
        detectPersons: z.boolean().optional(),
        detectSpeech: z.boolean().optional(),
      })
      .optional(),
    sprite: SpriteConfigSchema.optional(),
    filmstrip: FilmstripConfigSchema.optional(),
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
    config: z.object({
      confidenceThreshold: z.number().optional(),
      detectObjects: z.boolean().optional(),
      detectLabels: z.boolean().optional(),
      detectFaces: z.boolean().optional(),
      detectPersons: z.boolean().optional(),
      detectSpeech: z.boolean().optional(),
    }),
  }),
  // RenderTimelinePayload
  z.object({
    timelineId: z.string(),
    version: z.number(),
    tracks: z.array(z.any()), // TimelineTrack[] - validated separately
    outputSettings: RenderTimelineConfigSchema,
    provider: z.string().optional(),
  }),
  // GenerateTimelineRecommendationsPayload
  z.object({
    workspaceId: z.string(),
    timelineId: z.string(),
    seedClipId: z.string().optional(),
    targetMode: z.string(),
    strategies: z.array(z.string()),
    strategyWeights: z.record(z.string(), z.number()).optional(),
    searchParams: z
      .object({
        labelTypes: z.array(z.string()).optional(),
        minConfidence: z.number().optional(),
        durationRange: z
          .object({
            min: z.number(),
            max: z.number(),
          })
          .optional(),
        timeWindow: z.number().optional(),
      })
      .optional(),
    maxResults: z.number().optional(),
  }),
  // GenerateMediaRecommendationsPayload
  z.object({
    workspaceId: z.string(),
    mediaId: z.string(),
    strategies: z.array(z.string()),
    strategyWeights: z.record(z.string(), z.number()).optional(),
    filterParams: z
      .object({
        labelTypes: z.array(z.string()).optional(),
        minConfidence: z.number().optional(),
        durationRange: z
          .object({
            min: z.number(),
            max: z.number(),
          })
          .optional(),
      })
      .optional(),
    maxResults: z.number().optional(),
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
    probeOutput: z.any().optional(), // ProbeOutput - can be validated separately if needed
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
  // GenerateTimelineRecommendationsResult
  z.object({
    generated: z.number(),
    pruned: z.number(),
    queryHash: z.string(),
  }),
  // GenerateMediaRecommendationsResult
  z.object({
    generated: z.number(),
    pruned: z.number(),
    queryHash: z.string(),
  }),
  // Generic fallback for unknown task types
  z.record(z.string(), z.unknown()),
]);

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
      fontSize: z.number().optional(),
      color: z.string().optional(),
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
});

// ============================================================================
// TimelineRender Metadata
// ============================================================================

// TimelineRender doesn't have a metadata field in the schema,
// but we can define a schema for any future metadata needs
export const TimelineRenderMetadataSchema = z.object({});
