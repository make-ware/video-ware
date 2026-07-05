// Shared enums for the project

export enum UserRole {
  ADMIN = 'admin',
  USER = 'user',
  MODERATOR = 'moderator',
}

export enum PostStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
  ARCHIVED = 'archived',
}

export enum CollectionName {
  USERS = 'users',
  POSTS = 'posts',
  COMMENTS = 'comments',
}

// PocketBase collection names (type-safe)
export const COLLECTIONS = {
  USERS: 'users',
  POSTS: 'posts',
  COMMENTS: 'comments',
} as const;

export type CollectionNameType = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];

export enum UploadStatus {
  QUEUED = 'queued',
  UPLOADING = 'uploading',
  UPLOADED = 'uploaded',
  PROCESSING = 'processing',
  READY = 'ready',
  FAILED = 'failed',
}

export enum StorageBackendType {
  LOCAL = 'local',
  S3 = 's3',
}

export enum FileStatus {
  PENDING = 'pending',
  AVAILABLE = 'available',
  FAILED = 'failed',
  DELETED = 'deleted',
}

export enum FileType {
  ORIGINAL = 'original',
  PROXY = 'proxy',
  THUMBNAIL = 'thumbnail',
  SPRITE = 'sprite',
  FILMSTRIP = 'filmstrip',
  LABELS_JSON = 'labels_json',
  RENDER = 'render',
  AUDIO = 'audio',
}

export enum FileSource {
  S3 = 's3',
  POCKETBASE = 'pocketbase',
  GCS = 'gcs',
}

export enum MediaType {
  VIDEO = 'video',
  AUDIO = 'audio',
  IMAGE = 'image',
}

export enum ClipType {
  USER = 'user',
  FULL = 'full',
  RANGE = 'range',
  SHOT = 'shot',
  OBJECT = 'object',
  PERSON = 'person',
  FACE = 'face',
  SPEECH = 'speech',
  COMPOSITE = 'composite',
}

export enum LabelType {
  OBJECT = 'object',
  SHOT = 'shot',
  PERSON = 'person',
  SPEECH = 'speech',
  FACE = 'face',
  SEGMENT = 'segment',
  TEXT = 'text',
}

export enum TaskStatus {
  QUEUED = 'queued',
  RUNNING = 'running',
  SUCCESS = 'success',
  FAILED = 'failed',
  CANCELED = 'canceled',
}

export enum TaskType {
  PROCESS_UPLOAD = 'process_upload',
  DERIVE_CLIPS = 'derive_clips',
  DETECT_LABELS = 'detect_labels',
  RENDER_TIMELINE = 'render_timeline',
  FULL_INGEST = 'full_ingest',
  CLEANUP = 'cleanup',
}

// Lifecycle of an Artifacts row (a storage blob queued for deletion).
export enum ArtifactStatus {
  PENDING = 'pending',
  DELETED = 'deleted',
  FAILED = 'failed',
}

// Why a storage blob was queued for deletion. Drives observability only.
export enum ArtifactReason {
  FILE_DELETED = 'file_deleted',
  UPLOAD_DELETED = 'upload_deleted',
  TASK_FAILED = 'task_failed',
  TASK_CANCELED = 'task_canceled',
  RENDER_DELETED = 'render_deleted',
}

export enum ProcessingProvider {
  FFMPEG = 'ffmpeg',
  GOOGLE_TRANSCODER = 'google_transcoder',
  GOOGLE_VIDEO_INTELLIGENCE = 'google_video_intelligence',
  GOOGLE_SPEECH = 'google_speech',
}

export enum WorkspaceRole {
  OWNER = 'owner',
  ADMIN = 'admin',
  MEMBER = 'member',
  VIEWER = 'viewer',
}

export enum TimelineOrientation {
  LANDSCAPE = 'landscape',
  PORTRAIT = 'portrait',
}

// Maximum number of tracks per timeline. Keeps the preview player to a
// bounded number of simultaneous <video> elements.
export const MAX_TIMELINE_TRACKS = 4;

// Maximum number of inline media player channels the preview can drive at
// once. Nested-timeline clips expand into extra channels beyond the parent's
// own tracks; anything past this budget is dropped from preview (best effort)
// and surfaced as a warning. Rendering is unaffected by this limit.
export const MAX_PLAYBACK_CHANNELS = 6;

// Maximum nesting depth for timeline-in-timeline clips (a timeline containing
// a timeline containing a timeline = depth 3). Deeper references are ignored
// by both preview and render flattening; cycles are always ignored.
export const MAX_NESTED_TIMELINE_DEPTH = 3;

export enum CaptionType {
  CAPTION = 'caption',
  TITLE = 'title',
}

export const VIDEO_COLLECTIONS = {
  WORKSPACES: 'workspaces',
  WORKSPACE_MEMBERS: 'workspace_members',
  UPLOADS: 'uploads',
  FILES: 'files',
  MEDIA: 'media',
  MEDIA_CLIPS: 'media_clips',
  MEDIA_LABELS: 'media_labels',
  TASKS: 'tasks',
  TIMELINES: 'timelines',
  ARTIFACTS: 'artifacts',
} as const;

export type VideoCollectionName =
  (typeof VIDEO_COLLECTIONS)[keyof typeof VIDEO_COLLECTIONS];
