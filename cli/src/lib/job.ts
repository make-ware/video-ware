import { InvalidArgumentError } from 'commander';
import {
  ALL_LABEL_DETECTIONS,
  LABEL_JOB_TYPES,
  LABEL_JOB_TYPE_TO_CONFIG_KEY,
  MediaMutator,
  MediaType,
  ProcessingProvider,
  TaskMutator,
  TaskOrigin,
  TranscodeStepType,
  UploadMutator,
  ingestStepsFor,
  pickIngestTranscodeConfig,
  type IngestAssetStep,
  type DetectLabelsConfig,
  type DetectLabelsPayload,
  type LabelJobType,
  type Media,
  type ProcessUploadPayload,
  type Task,
  type TypedPocketBase,
  type Upload,
} from '@project/shared';

/**
 * Dev/admin job triggers (`vw job …`): create the same Task records the
 * webapp and ingest orchestrator create, so the worker re-runs transcode or
 * label detection for one media item. The CLI only queues the task — the
 * worker owns everything downstream (including pointing LabelJobs at the
 * task via JobService.syncLabelJobs).
 */

/** A media item resolved for job dispatch, with its source upload. */
export interface JobSource {
  media: Media;
  upload: Upload;
  /** Storage path of the stored original — the job's input file. */
  sourcePath: string;
}

/**
 * Resolve the media and its source upload, requiring a stored original:
 * both job kinds read the original file from storage, so a media that was
 * never ingested (no `externalPath`) has nothing for the worker to process.
 */
export async function resolveJobSource(
  pb: TypedPocketBase,
  mediaId: string
): Promise<JobSource> {
  const media = await new MediaMutator(pb).getById(mediaId, 'UploadRef');
  if (!media) {
    throw new Error(`Media not found: ${mediaId}`);
  }
  const upload =
    media.expand?.UploadRef ??
    (media.UploadRef
      ? await new UploadMutator(pb).getById(media.UploadRef)
      : null);
  if (!upload) {
    throw new Error(`Media ${mediaId} has no source upload record.`);
  }
  if (!upload.externalPath) {
    throw new Error(
      `Media ${mediaId} has no stored original file (the upload was never ` +
        'ingested) — there is nothing for the worker to process.'
    );
  }
  return { media, upload, sourcePath: upload.externalPath };
}

/**
 * Media.mediaType is typed `MediaType | MediaType[]` by the PB select-field
 * helper; the collection field is single-select, so unwrap the array form.
 */
function mediaTypeOf(media: Media): MediaType {
  return Array.isArray(media.mediaType) ? media.mediaType[0] : media.mediaType;
}

/** The user id jobs are attributed to — the authenticated CLI user. */
function requireUserId(pb: TypedPocketBase): string {
  const userId = pb.authStore.record?.id;
  if (!userId) {
    throw new Error('User must be authenticated to queue jobs.');
  }
  return userId;
}

/** Parse a comma-separated list of label job types (e.g. `speech,speaker`). */
export function parseLabelJobTypes(value: string): LabelJobType[] {
  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    throw new InvalidArgumentError(
      `expected comma-separated label types (${LABEL_JOB_TYPES.join(', ')})`
    );
  }
  const invalid = parts.filter(
    (part) => !(LABEL_JOB_TYPES as readonly string[]).includes(part)
  );
  if (invalid.length > 0) {
    throw new InvalidArgumentError(
      `invalid label type(s): ${invalid.join(', ')} ` +
        `(expected ${LABEL_JOB_TYPES.join(', ')})`
    );
  }
  return [...new Set(parts)] as LabelJobType[];
}

/**
 * Build the detection config for a detect_labels payload. With no types the
 * canonical "run everything" config is used. With a subset, unrequested
 * types are set to explicit `false` — object/shot default ON when the config
 * is silent (see isLabelTypeRequested), so omission would over-run.
 */
export function labelDetectionConfig(
  types?: LabelJobType[],
  confidenceThreshold = 0.5
): DetectLabelsConfig {
  if (!types || types.length === 0) {
    return { confidenceThreshold, ...ALL_LABEL_DETECTIONS };
  }
  const toggles = Object.fromEntries(
    LABEL_JOB_TYPES.map((type) => [
      LABEL_JOB_TYPE_TO_CONFIG_KEY[type],
      types.includes(type),
    ])
  ) as Omit<DetectLabelsConfig, 'confidenceThreshold'>;
  return { confidenceThreshold, ...toggles };
}

export interface CreateLabelJobOptions {
  mediaId: string;
  /** Label job types to run; defaults to all of them. */
  types?: LabelJobType[];
  /** Detection confidence threshold (0–1, default 0.5). */
  confidence?: number;
}

export interface QueuedLabelJob {
  task: Task;
  /** The types the task requests (config intent — env flags still gate). */
  types: LabelJobType[];
}

/**
 * Queue a detect_labels task for a media item, mirroring the webapp's
 * MediaService.createTaskForLabel. The requested types are intent only —
 * the worker's ENABLE_* env flags decide which detectors actually run.
 */
export async function createLabelJobTask(
  pb: TypedPocketBase,
  opts: CreateLabelJobOptions
): Promise<QueuedLabelJob> {
  const userId = requireUserId(pb);
  const { media, sourcePath } = await resolveJobSource(pb, opts.mediaId);
  if (mediaTypeOf(media) === MediaType.IMAGE) {
    throw new Error(
      `Media ${media.id} is an image — label detection only runs on ` +
        'media with temporal content (video/audio).'
    );
  }

  const payload: DetectLabelsPayload = {
    mediaId: media.id,
    fileRef: sourcePath,
    provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
    config: labelDetectionConfig(opts.types, opts.confidence),
  };
  const task = await new TaskMutator(pb).createDetectLabelsTask(
    media.WorkspaceRef,
    userId,
    media.id,
    payload
  );
  return {
    task,
    types: opts.types?.length ? opts.types : [...LABEL_JOB_TYPES],
  };
}

/**
 * The derived assets a transcode (process_upload) job can regenerate, in the
 * order the ingest spec lists them. `proxy` maps onto the payload's `transcode`
 * config — it is the web-playable preview the webapp calls the proxy file.
 */
export const TRANSCODE_ASSETS = [
  'thumbnail',
  'sprite',
  'filmstrip',
  'waveform',
  'proxy',
  'audio',
] as const;

export type TranscodeAsset = (typeof TRANSCODE_ASSETS)[number];

/** CLI asset name -> the transcode step that produces it. */
const ASSET_STEP: Record<TranscodeAsset, IngestAssetStep> = {
  thumbnail: TranscodeStepType.THUMBNAIL,
  sprite: TranscodeStepType.SPRITE,
  filmstrip: TranscodeStepType.FILMSTRIP,
  waveform: TranscodeStepType.WAVEFORM,
  proxy: TranscodeStepType.TRANSCODE,
  audio: TranscodeStepType.AUDIO,
};

/** Parse a comma-separated list of transcode assets (e.g. `proxy,sprite`). */
export function parseTranscodeAssets(value: string): TranscodeAsset[] {
  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    throw new InvalidArgumentError(
      `expected comma-separated assets (${TRANSCODE_ASSETS.join(', ')})`
    );
  }
  const invalid = parts.filter(
    (part) => !(TRANSCODE_ASSETS as readonly string[]).includes(part)
  );
  if (invalid.length > 0) {
    throw new InvalidArgumentError(
      `invalid asset(s): ${invalid.join(', ')} ` +
        `(expected ${TRANSCODE_ASSETS.join(', ')})`
    );
  }
  return [...new Set(parts)] as TranscodeAsset[];
}

/**
 * The assets a fresh ingest would generate for this media type — the default
 * when the caller doesn't restrict `--assets`. Derived from the shared ingest
 * spec, so it follows the media-type gating the worker actually applies.
 */
export function defaultTranscodeAssets(mediaType: MediaType): TranscodeAsset[] {
  const steps = new Set<IngestAssetStep>(ingestStepsFor(mediaType));
  return TRANSCODE_ASSETS.filter((asset) => steps.has(ASSET_STEP[asset]));
}

/**
 * Build a process_upload payload for the requested assets, using the shared
 * ingest spec's geometry so a regenerated asset is exactly what a fresh ingest
 * (or the weekly backfill) would produce. Assets that don't apply to the media
 * type are dropped.
 */
export function transcodePayload(
  media: Media,
  uploadId: string,
  assets: TranscodeAsset[]
): ProcessUploadPayload {
  return {
    uploadId,
    mediaId: media.id,
    provider: ProcessingProvider.FFMPEG,
    origin: TaskOrigin.USER,
    ...pickIngestTranscodeConfig(
      mediaTypeOf(media),
      assets.map((asset) => ASSET_STEP[asset])
    ),
  };
}

export interface CreateTranscodeJobOptions {
  mediaId: string;
  /** Assets to regenerate; defaults to all that apply to the media type. */
  assets?: TranscodeAsset[];
}

export interface QueuedTranscodeJob {
  task: Task;
  assets: TranscodeAsset[];
}

/**
 * Queue a process_upload (transcode/preview) task for a media item,
 * mirroring the webapp's MediaService.regeneratePreviews.
 */
export async function createTranscodeJobTask(
  pb: TypedPocketBase,
  opts: CreateTranscodeJobOptions
): Promise<QueuedTranscodeJob> {
  const userId = requireUserId(pb);
  const { media, upload } = await resolveJobSource(pb, opts.mediaId);
  const assets = opts.assets?.length
    ? opts.assets
    : defaultTranscodeAssets(mediaTypeOf(media));

  const task = await new TaskMutator(pb).createProcessUploadTask(
    media.WorkspaceRef,
    userId,
    upload.id,
    transcodePayload(media, upload.id, assets)
  );
  return { task, assets };
}
