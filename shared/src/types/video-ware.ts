import type {
  ClipType,
  FileSource,
  FileStatus,
  FileType,
  LabelType,
  MediaType,
  ProcessingProvider,
  TaskStatus,
  TaskType,
  UploadStatus,
  WorkspaceRole,
} from '../enums.js';

// ============================================================================
// App-level editing types
// ============================================================================

export type TimeOffset = {
  seconds: number;
  nanos: number;
};

export type EditListEntry = {
  key: string;
  inputs: string[];
  startTimeOffset: TimeOffset;
  endTimeOffset: TimeOffset;
};

export type EditList = EditListEntry[];

// ============================================================================
// Core domain record shapes (Phase 0: types only, no schemas)
// ============================================================================

export type WorkspaceRecord = {
  id: string;
  name: string;
  slug?: string;
  created: string;
  updated: string;
};

export type WorkspaceMemberRecord = {
  id: string;
  workspaceRef: string;
  userRef: string;
  role: WorkspaceRole;
  created: string;
  updated: string;
};

export type UploadRecord = {
  id: string;
  workspaceRef: string;
  name: string;
  size: number;
  status: UploadStatus;
  createdBy?: string;
  created: string;
  updated: string;
};

export type FileRecord = {
  id: string;
  workspaceRef: string;
  name: string;
  size: number;
  status: FileStatus;
  fileType: FileType;
  fileSource: FileSource;
  fileData?: Record<string, unknown>;
  taskRef?: string;
  mediaRef?: string;
  uploadRef?: string;
  createdBy?: string;
  created: string;
  updated: string;
};

export type MediaRecord = {
  id: string;
  workspaceRef: string;
  duration: number;
  start?: number;
  end?: number;
  thumbnailURL?: string;
  spriteURL?: string;
  mediaType: MediaType;
  mediaData?: Record<string, unknown>;
  uploadRef?: string;
  processingVersion?: number;
  createdBy?: string;
  created: string;
  updated: string;
};

export type MediaClipRecord = {
  id: string;
  workspaceRef: string;
  mediaRef: string;
  duration: number;
  start: number;
  end: number;
  type: ClipType;
  clipData?: Record<string, unknown>;
  createdBy?: string;
  created: string;
  updated: string;
};

export type MediaLabelRecord = {
  id: string;
  workspaceRef: string;
  mediaRef: string;
  duration: number;
  start: number;
  end: number;
  labelType: LabelType;
  labelData: Record<string, unknown>;
  provider: ProcessingProvider;
  version: number;
  confidence?: number;
  taskRef?: string;
  createdBy?: string;
  created: string;
  updated: string;
};

export type TaskRecord = {
  id: string;
  workspaceRef: string;
  type: TaskType;
  status: TaskStatus;
  progress?: number;
  priority?: number;
  attempts?: number;
  payload?: Record<string, unknown>;
  result?: Record<string, unknown>;
  errorLog?: string;
  uploadRef?: string;
  mediaRef?: string;
  createdBy?: string;
  created: string;
  updated: string;
};

export type TimelineRecord = {
  id: string;
  workspaceRef: string;
  name: string;
  duration?: number;
  version?: number;
  tracks?: unknown[]; // Using unknown[] for tracks to avoid circular dependency or complex types here
  renderTaskRef?: string;
  createdBy?: string;
  created: string;
  updated: string;
};

export type ClipRecommendationRecord = {
  id: string;
  workspaceRef: string;
  mediaRef: string;
  timelineRef?: string;
  seedClipRef?: string;
  MediaClipRef: string;
  score: number;
  rank: number;
  reason: string;
  reasonData?: Record<string, unknown>;
  strategy?: string;
  queryHash: string;
  expiresAt: string;
  acceptedAt?: string;
  dismissedAt?: string;
  createdBy?: string;
  created: string;
  updated: string;
};

// ============================================================================
// Google detection response fragments (stored in labelData)
// ============================================================================

export type AttributeObject = {
  name: string;
  confidence: number;
  value?: string;
};

export type ObjectAttributes = Array<AttributeObject> | null;

export type LandmarkObject = {
  name: string;
  point: { x: number; y: number };
  confidence: number;
};

export type WordObject = {
  word: string;
  startTimeOffset: number;
  endTimeOffset: number;
  speakerTag?: number;
};

export type BaseSegmentFragment = {
  segment_startTimeOffset: number;
  segment_endTimeOffset: number;
  segment_timeLength: number;
};

export type BaseFrameFragment = {
  frame_nid: number;
  frame_timeOffset: number;
  frame_timeLeft: number;
  frame_centerX: number;
  frame_centerY: number;
  frame_deltaX: number;
  frame_deltaY: number;
  frame_bottom: number;
  frame_left: number;
  frame_right: number;
  frame_top: number;
};

export type BaseReferenceFragment = {
  taskRefId?: string;
  mediaRefId: string;
  workspaceRefId: string;
};

export type BaseEntityFragment = {
  entity_id?: string;
  entity_description?: string;
};
