/**
 * This file was @generated using pocketbase-typegen
 */

import type PocketBase from 'pocketbase';
import type { RecordService } from 'pocketbase';

export enum Collections {
  Artifacts = 'Artifacts',
  Captions = 'Captions',
  ClipLabelSearch = 'ClipLabelSearch',
  Directories = 'Directories',
  Entities = 'Entities',
  EntityStats = 'EntityStats',
  Files = 'Files',
  LabelEntity = 'LabelEntity',
  LabelFaces = 'LabelFaces',
  LabelJobs = 'LabelJobs',
  LabelObjects = 'LabelObjects',
  LabelPerson = 'LabelPerson',
  LabelSegments = 'LabelSegments',
  LabelShots = 'LabelShots',
  LabelSpeaker = 'LabelSpeaker',
  LabelSpeech = 'LabelSpeech',
  LabelText = 'LabelText',
  LabelTrack = 'LabelTrack',
  Media = 'Media',
  MediaClipLabels = 'MediaClipLabels',
  MediaClips = 'MediaClips',
  MediaRecommendations = 'MediaRecommendations',
  Tasks = 'Tasks',
  TimelineClips = 'TimelineClips',
  TimelineRecommendations = 'TimelineRecommendations',
  TimelineRenders = 'TimelineRenders',
  TimelineTracks = 'TimelineTracks',
  Timelines = 'Timelines',
  Uploads = 'Uploads',
  UsageEvents = 'UsageEvents',
  Users = 'Users',
  WatchFolderImports = 'WatchFolderImports',
  WorkspaceMembers = 'WorkspaceMembers',
  Workspaces = 'Workspaces',
  Authorigins = '_authOrigins',
  Externalauths = '_externalAuths',
  Mfas = '_mfas',
  Otps = '_otps',
  Superusers = '_superusers',
}

// Alias types for improved usability
export type IsoDateString = string;
export type IsoAutoDateString = string & { readonly autodate: unique symbol };
export type RecordIdString = string;
export type FileNameString = string & { readonly filename: unique symbol };
export type HTMLString = string;

type ExpandType<T> = unknown extends T
  ? T extends unknown
    ? { expand?: unknown }
    : { expand: T }
  : { expand: T };

// System fields
export type BaseSystemFields<T = unknown> = {
  id: RecordIdString;
  collectionId: string;
  collectionName: Collections;
} & ExpandType<T>;

export type AuthSystemFields<T = unknown> = {
  email: string;
  emailVisibility: boolean;
  username: string;
  verified: boolean;
} & BaseSystemFields<T>;

// Record types for each collection

export enum ArtifactsFileSourceOptions {
  's3' = 's3',
  'pocketbase' = 'pocketbase',
  'gcs' = 'gcs',
}

export enum ArtifactsStatusOptions {
  'pending' = 'pending',
  'deleted' = 'deleted',
  'failed' = 'failed',
}
export type ArtifactsRecord = {
  WorkspaceRef?: RecordIdString;
  attempts?: number;
  created: IsoAutoDateString;
  errorLog?: string;
  fileSource: ArtifactsFileSourceOptions;
  id: string;
  reason?: string;
  sourceCollection?: string;
  sourceId?: string;
  status: ArtifactsStatusOptions;
  storageKey: string;
  updated: IsoAutoDateString;
};

export enum CaptionsCaptionTypeOptions {
  'caption' = 'caption',
  'title' = 'title',
}
export type CaptionsRecord<
  Tcues = unknown,
  Tmetadata = unknown,
  Tstyle = unknown,
> = {
  MediaRef?: RecordIdString;
  UserRef?: RecordIdString;
  WorkspaceRef: RecordIdString;
  captionType: CaptionsCaptionTypeOptions;
  created: IsoAutoDateString;
  cues?: null | Tcues;
  duration?: number;
  end?: number;
  id: string;
  metadata?: null | Tmetadata;
  name?: string;
  start?: number;
  style?: null | Tstyle;
  text: string;
  updated: IsoAutoDateString;
};

export type ClipLabelSearchRecord<
  TWorkspaceRef = unknown,
  Tcategory = unknown,
  TclipId = unknown,
  Tconfidence = unknown,
  TmatchText = unknown,
> = {
  WorkspaceRef?: null | TWorkspaceRef;
  category?: null | Tcategory;
  clipId?: null | TclipId;
  confidence?: null | Tconfidence;
  id: string;
  matchText?: null | TmatchText;
};

export type DirectoriesRecord = {
  WorkspaceRef: RecordIdString;
  created: IsoAutoDateString;
  id: string;
  name: string;
  updated: IsoAutoDateString;
};

export enum EntitiesKindOptions {
  'person' = 'person',
  'product' = 'product',
  'place' = 'place',
  'thing' = 'thing',
}
export type EntitiesRecord<Taliases = unknown, Tmetadata = unknown> = {
  WorkspaceRef: RecordIdString;
  aliases?: null | Taliases;
  created: IsoAutoDateString;
  description?: string;
  id: string;
  kind: EntitiesKindOptions;
  metadata?: null | Tmetadata;
  name: string;
  updated: IsoAutoDateString;
};

export type EntityStatsRecord<
  TlabelCount = unknown,
  TmediaCount = unknown,
  TthumbTrack = unknown,
  TtrackCount = unknown,
  TutteranceCount = unknown,
> = {
  WorkspaceRef: RecordIdString;
  id: string;
  labelCount?: null | TlabelCount;
  mediaCount?: null | TmediaCount;
  thumbTrack?: null | TthumbTrack;
  trackCount?: null | TtrackCount;
  utteranceCount?: null | TutteranceCount;
};

export enum FilesFileStatusOptions {
  'pending' = 'pending',
  'available' = 'available',
  'failed' = 'failed',
  'deleted' = 'deleted',
}

export enum FilesFileTypeOptions {
  'original' = 'original',
  'proxy' = 'proxy',
  'audio' = 'audio',
  'thumbnail' = 'thumbnail',
  'sprite' = 'sprite',
  'labels_json' = 'labels_json',
  'render' = 'render',
  'filmstrip' = 'filmstrip',
}

export enum FilesFileSourceOptions {
  's3' = 's3',
  'pocketbase' = 'pocketbase',
  'gcs' = 'gcs',
}
export type FilesRecord<Tmeta = unknown> = {
  MediaRef?: RecordIdString;
  UploadRef?: RecordIdString;
  WorkspaceRef: RecordIdString;
  created: IsoAutoDateString;
  file?: FileNameString;
  fileSource: FilesFileSourceOptions;
  fileStatus: FilesFileStatusOptions;
  fileType: FilesFileTypeOptions;
  id: string;
  meta?: null | Tmeta;
  name: string;
  size: number;
  storageKey?: string;
  updated: IsoAutoDateString;
};

export enum LabelEntityLabelTypeOptions {
  'object' = 'object',
  'shot' = 'shot',
  'person' = 'person',
  'speech' = 'speech',
  'face' = 'face',
  'segment' = 'segment',
  'text' = 'text',
  'speaker' = 'speaker',
}

export enum LabelEntityProviderOptions {
  'google_video_intelligence' = 'google_video_intelligence',
  'google_speech' = 'google_speech',
  'elevenlabs' = 'elevenlabs',
}
export type LabelEntityRecord<Tmetadata = unknown> = {
  EntityRef?: RecordIdString;
  WorkspaceRef: RecordIdString;
  canonicalName: string;
  created: IsoAutoDateString;
  entityHash: string;
  id: string;
  labelType: LabelEntityLabelTypeOptions;
  metadata?: null | Tmetadata;
  processor: string;
  provider: LabelEntityProviderOptions;
  updated: IsoAutoDateString;
};

export type LabelFacesRecord<Tembedding = unknown, Tmetadata = unknown> = {
  LabelEntityRef: RecordIdString;
  LabelTrackRef?: RecordIdString;
  MediaRef: RecordIdString;
  WorkspaceRef: RecordIdString;
  angerLikelihood?: string;
  avgConfidence?: number;
  blurredLikelihood?: string;
  created: IsoAutoDateString;
  duration?: number;
  embedding?: null | Tembedding;
  embeddingModel?: string;
  end?: number;
  faceHash: string;
  faceId?: string;
  headwearLikelihood?: string;
  id: string;
  joyLikelihood?: string;
  lookingAtCameraLikelihood?: string;
  metadata: null | Tmetadata;
  qualityScore?: number;
  sorrowLikelihood?: string;
  start?: number;
  surpriseLikelihood?: string;
  underExposedLikelihood?: string;
  updated: IsoAutoDateString;
  version?: number;
  visualHash?: string;
};

export type LabelJobsRecord = {
  MediaRef: RecordIdString;
  TaskRef?: RecordIdString;
  created: IsoAutoDateString;
  id: string;
  jobType: string;
  updated: IsoAutoDateString;
  version?: number;
};

export type LabelObjectsRecord<Tmetadata = unknown> = {
  LabelEntityRef: RecordIdString;
  LabelTrackRef?: RecordIdString;
  MediaRef: RecordIdString;
  WorkspaceRef: RecordIdString;
  confidence?: number;
  created: IsoAutoDateString;
  duration?: number;
  end?: number;
  entity: string;
  id: string;
  metadata: null | Tmetadata;
  objectHash: string;
  originalTrackId: string;
  start?: number;
  updated: IsoAutoDateString;
  version?: number;
};

export type LabelPersonRecord<Tmetadata = unknown> = {
  LabelEntityRef: RecordIdString;
  LabelTrackRef: RecordIdString;
  MediaRef: RecordIdString;
  WorkspaceRef: RecordIdString;
  confidence?: number;
  created: IsoAutoDateString;
  duration?: number;
  end?: number;
  hasLandmarks?: boolean;
  id: string;
  lowerBodyColor?: string;
  metadata: null | Tmetadata;
  personHash: string;
  personId: string;
  start?: number;
  updated: IsoAutoDateString;
  upperBodyColor?: string;
};

export enum LabelSegmentsLabelTypeOptions {
  'segment' = 'segment',
  'object' = 'object',
  'person' = 'person',
  'face' = 'face',
}
export type LabelSegmentsRecord<Tmetadata = unknown> = {
  LabelEntityRef?: RecordIdString;
  MediaRef: RecordIdString;
  WorkspaceRef: RecordIdString;
  confidence?: number;
  created: IsoAutoDateString;
  duration?: number;
  end?: number;
  entity: string;
  id: string;
  labelType: LabelSegmentsLabelTypeOptions;
  metadata: null | Tmetadata;
  segmentHash: string;
  start?: number;
  updated: IsoAutoDateString;
  version?: number;
};

export type LabelShotsRecord<Tmetadata = unknown> = {
  LabelEntityRef?: RecordIdString;
  MediaRef: RecordIdString;
  WorkspaceRef: RecordIdString;
  confidence?: number;
  created: IsoAutoDateString;
  duration?: number;
  end?: number;
  entity: string;
  id: string;
  metadata: null | Tmetadata;
  shotHash: string;
  start?: number;
  updated: IsoAutoDateString;
};

export type LabelSpeakerRecord<Tmetadata = unknown, Twords = unknown> = {
  LabelEntityRef?: RecordIdString;
  LabelTrackRef?: RecordIdString;
  MediaRef: RecordIdString;
  WorkspaceRef: RecordIdString;
  confidence?: number;
  created: IsoAutoDateString;
  duration?: number;
  end?: number;
  id: string;
  languageCode?: string;
  metadata?: null | Tmetadata;
  speakerHash: string;
  speakerId: string;
  start?: number;
  transcript: string;
  updated: IsoAutoDateString;
  words?: null | Twords;
};

export type LabelSpeechRecord<Tmetadata = unknown, Twords = unknown> = {
  LabelEntityRef?: RecordIdString;
  LabelTrackRef?: RecordIdString;
  MediaRef: RecordIdString;
  WorkspaceRef: RecordIdString;
  confidence?: number;
  created: IsoAutoDateString;
  duration?: number;
  end?: number;
  id: string;
  languageCode?: string;
  metadata?: null | Tmetadata;
  speakerTag?: number;
  speechHash: string;
  start?: number;
  transcript: string;
  updated: IsoAutoDateString;
  words?: null | Twords;
};

export type LabelTextRecord<Tmetadata = unknown> = {
  LabelEntityRef?: RecordIdString;
  LabelTrackRef?: RecordIdString;
  MediaRef: RecordIdString;
  WorkspaceRef: RecordIdString;
  confidence?: number;
  created: IsoAutoDateString;
  duration?: number;
  end?: number;
  id: string;
  metadata?: null | Tmetadata;
  start?: number;
  text: string;
  textHash: string;
  updated: IsoAutoDateString;
};

export type LabelTrackRecord<
  TboundingBox = unknown,
  Tkeyframes = unknown,
  TtrackData = unknown,
> = {
  EntityRef?: RecordIdString;
  LabelEntityRef?: RecordIdString;
  MediaRef: RecordIdString;
  WorkspaceRef: RecordIdString;
  boundingBox?: null | TboundingBox;
  confidence?: number;
  created: IsoAutoDateString;
  duration?: number;
  end?: number;
  id: string;
  keyframes?: null | Tkeyframes;
  start?: number;
  trackData: null | TtrackData;
  trackHash: string;
  trackId: string;
  updated: IsoAutoDateString;
};

export enum MediaMediaTypeOptions {
  'video' = 'video',
  'audio' = 'audio',
  'image' = 'image',
}
export type MediaRecord<TmediaData = unknown> = {
  DirectoryRef?: RecordIdString;
  UploadRef: RecordIdString;
  WorkspaceRef: RecordIdString;
  aspectRatio?: number;
  audioFileRef?: RecordIdString;
  created: IsoAutoDateString;
  description?: string;
  duration?: number;
  filmstripFileRefs?: RecordIdString[];
  hasAudio?: boolean;
  height?: number;
  id: string;
  isActive?: boolean;
  label?: string;
  mediaData: null | TmediaData;
  mediaDate?: IsoDateString;
  mediaType: MediaMediaTypeOptions;
  processor?: string;
  proxyFileRef?: RecordIdString;
  spriteFileRef?: RecordIdString;
  thumbnailFileRef?: RecordIdString;
  updated: IsoAutoDateString;
  version?: number;
  width?: number;
};

export enum MediaClipLabelsLabelTypeOptions {
  'object' = 'object',
  'shot' = 'shot',
  'person' = 'person',
  'speech' = 'speech',
  'face' = 'face',
  'segment' = 'segment',
  'text' = 'text',
  'speaker' = 'speaker',
}
export type MediaClipLabelsRecord<Tmetadata = unknown> = {
  LabelFaceRef?: RecordIdString;
  LabelObjectRef?: RecordIdString;
  LabelPersonRef?: RecordIdString;
  LabelSegmentRef?: RecordIdString;
  LabelShotRef?: RecordIdString;
  LabelSpeakerRef?: RecordIdString;
  LabelSpeechRef?: RecordIdString;
  LabelTextRef?: RecordIdString;
  MediaClipRef: RecordIdString;
  WorkspaceRef: RecordIdString;
  confidence?: number;
  created: IsoAutoDateString;
  id: string;
  labelType: MediaClipLabelsLabelTypeOptions;
  metadata?: null | Tmetadata;
  updated: IsoAutoDateString;
};

export type MediaClipsRecord<TclipData = unknown> = {
  MediaRef: RecordIdString;
  WorkspaceRef: RecordIdString;
  clipData?: null | TclipData;
  created: IsoAutoDateString;
  description?: string;
  duration?: number;
  end?: number;
  id: string;
  label?: string;
  processor?: string;
  start?: number;
  type: string;
  updated: IsoAutoDateString;
  version?: number;
};

export type MediaRecommendationsRecord<TreasonData = unknown> = {
  MediaClipsRef?: RecordIdString[];
  MediaRef: RecordIdString;
  WorkspaceRef: RecordIdString;
  created: IsoAutoDateString;
  end?: number;
  id: string;
  labelType: string;
  processor?: string;
  queryHash: string;
  rank?: number;
  reason: string;
  reasonData: null | TreasonData;
  score?: number;
  start?: number;
  strategy: string;
  updated: IsoAutoDateString;
  version?: number;
};

export enum TasksStatusOptions {
  'queued' = 'queued',
  'running' = 'running',
  'success' = 'success',
  'failed' = 'failed',
  'canceled' = 'canceled',
}

export enum TasksProviderOptions {
  'ffmpeg' = 'ffmpeg',
  'google_transcoder' = 'google_transcoder',
  'google_video_intelligence' = 'google_video_intelligence',
  'google_speech' = 'google_speech',
}
export type TasksRecord<Tpayload = unknown, Tresult = unknown> = {
  UserRef?: RecordIdString;
  WorkspaceRef?: RecordIdString;
  attempts?: number;
  bullJobId?: string;
  created: IsoAutoDateString;
  errorLog?: string;
  id: string;
  payload: null | Tpayload;
  priority?: number;
  progress?: number;
  provider?: TasksProviderOptions;
  queueName?: string;
  result?: null | Tresult;
  sourceId: string;
  sourceType: string;
  status: TasksStatusOptions;
  type: string;
  updated: IsoAutoDateString;
  version?: string;
};

export type TimelineClipsRecord<Tmeta = unknown> = {
  CaptionRef?: RecordIdString;
  MediaClipRef?: RecordIdString;
  MediaRef?: RecordIdString;
  SourceTimelineRef?: RecordIdString;
  TimelineRef: RecordIdString;
  TimelineTrackRef?: RecordIdString;
  created: IsoAutoDateString;
  description?: string;
  duration?: number;
  end?: number;
  id: string;
  label?: string;
  meta?: null | Tmeta;
  order?: number;
  start?: number;
  timelineStart?: number;
  updated: IsoAutoDateString;
};

export type TimelineRecommendationsRecord<TreasonData = unknown> = {
  MediaClipRef: RecordIdString;
  SeedClipRef?: RecordIdString;
  TimelineClipsRef?: RecordIdString[];
  TimelineRef: RecordIdString;
  WorkspaceRef: RecordIdString;
  acceptedAt?: IsoDateString;
  created: IsoAutoDateString;
  dismissedAt?: IsoDateString;
  id: string;
  processor?: string;
  queryHash: string;
  rank?: number;
  reason: string;
  reasonData: null | TreasonData;
  score?: number;
  strategy: string;
  targetMode: string;
  updated: IsoAutoDateString;
  version?: number;
};

export enum TimelineRendersStatusOptions {
  'queued' = 'queued',
  'running' = 'running',
  'success' = 'success',
  'failed' = 'failed',
  'canceled' = 'canceled',
}
export type TimelineRendersRecord<
  ToutputSettings = unknown,
  TtimelineData = unknown,
> = {
  FileRef?: RecordIdString;
  TimelineRef: RecordIdString;
  UserRef?: RecordIdString;
  WorkspaceRef?: RecordIdString;
  created: IsoAutoDateString;
  errorLog?: string;
  id: string;
  outputSettings?: null | ToutputSettings;
  processor?: string;
  progress?: number;
  status?: TimelineRendersStatusOptions;
  timelineData?: null | TtimelineData;
  updated: IsoAutoDateString;
  version?: number;
};

export type TimelineTracksRecord = {
  TimelineRef: RecordIdString;
  created: IsoAutoDateString;
  description?: string;
  id: string;
  isLocked?: boolean;
  isMuted?: boolean;
  label?: string;
  layer?: number;
  name?: string;
  opacity?: number;
  updated: IsoAutoDateString;
  volume?: number;
};

export enum TimelinesOrientationOptions {
  'landscape' = 'landscape',
  'portrait' = 'portrait',
}
export type TimelinesRecord = {
  UserRef?: RecordIdString;
  WorkspaceRef: RecordIdString;
  created: IsoAutoDateString;
  description?: string;
  duration?: number;
  id: string;
  label?: string;
  name: string;
  orientation?: TimelinesOrientationOptions;
  processor?: string;
  updated: IsoAutoDateString;
  version?: number;
};

export enum UploadsStatusOptions {
  'queued' = 'queued',
  'uploading' = 'uploading',
  'uploaded' = 'uploaded',
  'processing' = 'processing',
  'ready' = 'ready',
  'failed' = 'failed',
}

export enum UploadsStorageBackendOptions {
  'local' = 'local',
  's3' = 's3',
}
export type UploadsRecord<TstorageConfig = unknown> = {
  DirectoryRef?: RecordIdString;
  UserRef: RecordIdString;
  WorkspaceRef: RecordIdString;
  bytesUploaded?: number;
  created: IsoAutoDateString;
  errorMessage?: string;
  externalPath?: string;
  id: string;
  name: string;
  size: number;
  status: UploadsStatusOptions;
  storageBackend?: UploadsStorageBackendOptions;
  storageConfig?: null | TstorageConfig;
  updated: IsoAutoDateString;
};

export type UsageEventsRecord<Tmetadata = unknown> = {
  WorkspaceRef: RecordIdString;
  created: IsoAutoDateString;
  id: string;
  metadata?: null | Tmetadata;
  subtype: string;
  type: string;
  unit: string;
  updated: IsoAutoDateString;
  value?: number;
};

export type UsersRecord = {
  avatar?: FileNameString;
  created: IsoAutoDateString;
  email: string;
  emailVisibility?: boolean;
  id: string;
  name?: string;
  password: string;
  tokenKey: string;
  updated: IsoAutoDateString;
  verified?: boolean;
};

export enum WatchFolderImportsStatusOptions {
  'importing' = 'importing',
  'imported' = 'imported',
  'failed' = 'failed',
  'skipped' = 'skipped',
}
export type WatchFolderImportsRecord = {
  UploadRef?: RecordIdString;
  WorkspaceRef?: RecordIdString;
  created: IsoAutoDateString;
  error?: string;
  etag: string;
  id: string;
  key: string;
  size?: number;
  status: WatchFolderImportsStatusOptions;
  updated: IsoAutoDateString;
};

export type WorkspaceMembersRecord = {
  UserRef: RecordIdString;
  WorkspaceRef: RecordIdString;
  created: IsoAutoDateString;
  id: string;
  updated: IsoAutoDateString;
};

export type WorkspacesRecord<Tsettings = unknown> = {
  created: IsoAutoDateString;
  id: string;
  name: string;
  settings?: null | Tsettings;
  slug?: string;
  updated: IsoAutoDateString;
};

export type AuthoriginsRecord = {
  collectionRef: string;
  created: IsoAutoDateString;
  fingerprint: string;
  id: string;
  recordRef: string;
  updated: IsoAutoDateString;
};

export type ExternalauthsRecord = {
  collectionRef: string;
  created: IsoAutoDateString;
  id: string;
  provider: string;
  providerId: string;
  recordRef: string;
  updated: IsoAutoDateString;
};

export type MfasRecord = {
  collectionRef: string;
  created: IsoAutoDateString;
  id: string;
  method: string;
  recordRef: string;
  updated: IsoAutoDateString;
};

export type OtpsRecord = {
  collectionRef: string;
  created: IsoAutoDateString;
  id: string;
  password: string;
  recordRef: string;
  sentTo?: string;
  updated: IsoAutoDateString;
};

export type SuperusersRecord = {
  created: IsoAutoDateString;
  email: string;
  emailVisibility?: boolean;
  id: string;
  password: string;
  tokenKey: string;
  updated: IsoAutoDateString;
  verified?: boolean;
};

// Response types include system fields and match responses from the PocketBase API
export type ArtifactsResponse<Texpand = unknown> = Required<ArtifactsRecord> &
  BaseSystemFields<Texpand>;
export type CaptionsResponse<
  Tcues = unknown,
  Tmetadata = unknown,
  Tstyle = unknown,
  Texpand = unknown,
> = Required<CaptionsRecord<Tcues, Tmetadata, Tstyle>> &
  BaseSystemFields<Texpand>;
export type ClipLabelSearchResponse<
  TWorkspaceRef = unknown,
  Tcategory = unknown,
  TclipId = unknown,
  Tconfidence = unknown,
  TmatchText = unknown,
  Texpand = unknown,
> = Required<
  ClipLabelSearchRecord<
    TWorkspaceRef,
    Tcategory,
    TclipId,
    Tconfidence,
    TmatchText
  >
> &
  BaseSystemFields<Texpand>;
export type DirectoriesResponse<Texpand = unknown> =
  Required<DirectoriesRecord> & BaseSystemFields<Texpand>;
export type EntitiesResponse<
  Taliases = unknown,
  Tmetadata = unknown,
  Texpand = unknown,
> = Required<EntitiesRecord<Taliases, Tmetadata>> & BaseSystemFields<Texpand>;
export type EntityStatsResponse<
  TlabelCount = unknown,
  TmediaCount = unknown,
  TthumbTrack = unknown,
  TtrackCount = unknown,
  TutteranceCount = unknown,
  Texpand = unknown,
> = Required<
  EntityStatsRecord<
    TlabelCount,
    TmediaCount,
    TthumbTrack,
    TtrackCount,
    TutteranceCount
  >
> &
  BaseSystemFields<Texpand>;
export type FilesResponse<Tmeta = unknown, Texpand = unknown> = Required<
  FilesRecord<Tmeta>
> &
  BaseSystemFields<Texpand>;
export type LabelEntityResponse<
  Tmetadata = unknown,
  Texpand = unknown,
> = Required<LabelEntityRecord<Tmetadata>> & BaseSystemFields<Texpand>;
export type LabelFacesResponse<
  Tembedding = unknown,
  Tmetadata = unknown,
  Texpand = unknown,
> = Required<LabelFacesRecord<Tembedding, Tmetadata>> &
  BaseSystemFields<Texpand>;
export type LabelJobsResponse<Texpand = unknown> = Required<LabelJobsRecord> &
  BaseSystemFields<Texpand>;
export type LabelObjectsResponse<
  Tmetadata = unknown,
  Texpand = unknown,
> = Required<LabelObjectsRecord<Tmetadata>> & BaseSystemFields<Texpand>;
export type LabelPersonResponse<
  Tmetadata = unknown,
  Texpand = unknown,
> = Required<LabelPersonRecord<Tmetadata>> & BaseSystemFields<Texpand>;
export type LabelSegmentsResponse<
  Tmetadata = unknown,
  Texpand = unknown,
> = Required<LabelSegmentsRecord<Tmetadata>> & BaseSystemFields<Texpand>;
export type LabelShotsResponse<
  Tmetadata = unknown,
  Texpand = unknown,
> = Required<LabelShotsRecord<Tmetadata>> & BaseSystemFields<Texpand>;
export type LabelSpeakerResponse<
  Tmetadata = unknown,
  Twords = unknown,
  Texpand = unknown,
> = Required<LabelSpeakerRecord<Tmetadata, Twords>> & BaseSystemFields<Texpand>;
export type LabelSpeechResponse<
  Tmetadata = unknown,
  Twords = unknown,
  Texpand = unknown,
> = Required<LabelSpeechRecord<Tmetadata, Twords>> & BaseSystemFields<Texpand>;
export type LabelTextResponse<
  Tmetadata = unknown,
  Texpand = unknown,
> = Required<LabelTextRecord<Tmetadata>> & BaseSystemFields<Texpand>;
export type LabelTrackResponse<
  TboundingBox = unknown,
  Tkeyframes = unknown,
  TtrackData = unknown,
  Texpand = unknown,
> = Required<LabelTrackRecord<TboundingBox, Tkeyframes, TtrackData>> &
  BaseSystemFields<Texpand>;
export type MediaResponse<TmediaData = unknown, Texpand = unknown> = Required<
  MediaRecord<TmediaData>
> &
  BaseSystemFields<Texpand>;
export type MediaClipLabelsResponse<
  Tmetadata = unknown,
  Texpand = unknown,
> = Required<MediaClipLabelsRecord<Tmetadata>> & BaseSystemFields<Texpand>;
export type MediaClipsResponse<
  TclipData = unknown,
  Texpand = unknown,
> = Required<MediaClipsRecord<TclipData>> & BaseSystemFields<Texpand>;
export type MediaRecommendationsResponse<
  TreasonData = unknown,
  Texpand = unknown,
> = Required<MediaRecommendationsRecord<TreasonData>> &
  BaseSystemFields<Texpand>;
export type TasksResponse<
  Tpayload = unknown,
  Tresult = unknown,
  Texpand = unknown,
> = Required<TasksRecord<Tpayload, Tresult>> & BaseSystemFields<Texpand>;
export type TimelineClipsResponse<
  Tmeta = unknown,
  Texpand = unknown,
> = Required<TimelineClipsRecord<Tmeta>> & BaseSystemFields<Texpand>;
export type TimelineRecommendationsResponse<
  TreasonData = unknown,
  Texpand = unknown,
> = Required<TimelineRecommendationsRecord<TreasonData>> &
  BaseSystemFields<Texpand>;
export type TimelineRendersResponse<
  ToutputSettings = unknown,
  TtimelineData = unknown,
  Texpand = unknown,
> = Required<TimelineRendersRecord<ToutputSettings, TtimelineData>> &
  BaseSystemFields<Texpand>;
export type TimelineTracksResponse<Texpand = unknown> =
  Required<TimelineTracksRecord> & BaseSystemFields<Texpand>;
export type TimelinesResponse<Texpand = unknown> = Required<TimelinesRecord> &
  BaseSystemFields<Texpand>;
export type UploadsResponse<
  TstorageConfig = unknown,
  Texpand = unknown,
> = Required<UploadsRecord<TstorageConfig>> & BaseSystemFields<Texpand>;
export type UsageEventsResponse<
  Tmetadata = unknown,
  Texpand = unknown,
> = Required<UsageEventsRecord<Tmetadata>> & BaseSystemFields<Texpand>;
export type UsersResponse<Texpand = unknown> = Required<UsersRecord> &
  AuthSystemFields<Texpand>;
export type WatchFolderImportsResponse<Texpand = unknown> =
  Required<WatchFolderImportsRecord> & BaseSystemFields<Texpand>;
export type WorkspaceMembersResponse<Texpand = unknown> =
  Required<WorkspaceMembersRecord> & BaseSystemFields<Texpand>;
export type WorkspacesResponse<
  Tsettings = unknown,
  Texpand = unknown,
> = Required<WorkspacesRecord<Tsettings>> & BaseSystemFields<Texpand>;
export type AuthoriginsResponse<Texpand = unknown> =
  Required<AuthoriginsRecord> & BaseSystemFields<Texpand>;
export type ExternalauthsResponse<Texpand = unknown> =
  Required<ExternalauthsRecord> & BaseSystemFields<Texpand>;
export type MfasResponse<Texpand = unknown> = Required<MfasRecord> &
  BaseSystemFields<Texpand>;
export type OtpsResponse<Texpand = unknown> = Required<OtpsRecord> &
  BaseSystemFields<Texpand>;
export type SuperusersResponse<Texpand = unknown> = Required<SuperusersRecord> &
  AuthSystemFields<Texpand>;

// Types containing all Records and Responses, useful for creating typing helper functions

export type CollectionRecords = {
  Artifacts: ArtifactsRecord;
  Captions: CaptionsRecord;
  ClipLabelSearch: ClipLabelSearchRecord;
  Directories: DirectoriesRecord;
  Entities: EntitiesRecord;
  EntityStats: EntityStatsRecord;
  Files: FilesRecord;
  LabelEntity: LabelEntityRecord;
  LabelFaces: LabelFacesRecord;
  LabelJobs: LabelJobsRecord;
  LabelObjects: LabelObjectsRecord;
  LabelPerson: LabelPersonRecord;
  LabelSegments: LabelSegmentsRecord;
  LabelShots: LabelShotsRecord;
  LabelSpeaker: LabelSpeakerRecord;
  LabelSpeech: LabelSpeechRecord;
  LabelText: LabelTextRecord;
  LabelTrack: LabelTrackRecord;
  Media: MediaRecord;
  MediaClipLabels: MediaClipLabelsRecord;
  MediaClips: MediaClipsRecord;
  MediaRecommendations: MediaRecommendationsRecord;
  Tasks: TasksRecord;
  TimelineClips: TimelineClipsRecord;
  TimelineRecommendations: TimelineRecommendationsRecord;
  TimelineRenders: TimelineRendersRecord;
  TimelineTracks: TimelineTracksRecord;
  Timelines: TimelinesRecord;
  Uploads: UploadsRecord;
  UsageEvents: UsageEventsRecord;
  Users: UsersRecord;
  WatchFolderImports: WatchFolderImportsRecord;
  WorkspaceMembers: WorkspaceMembersRecord;
  Workspaces: WorkspacesRecord;
  _authOrigins: AuthoriginsRecord;
  _externalAuths: ExternalauthsRecord;
  _mfas: MfasRecord;
  _otps: OtpsRecord;
  _superusers: SuperusersRecord;
};

export type CollectionResponses = {
  Artifacts: ArtifactsResponse;
  Captions: CaptionsResponse;
  ClipLabelSearch: ClipLabelSearchResponse;
  Directories: DirectoriesResponse;
  Entities: EntitiesResponse;
  EntityStats: EntityStatsResponse;
  Files: FilesResponse;
  LabelEntity: LabelEntityResponse;
  LabelFaces: LabelFacesResponse;
  LabelJobs: LabelJobsResponse;
  LabelObjects: LabelObjectsResponse;
  LabelPerson: LabelPersonResponse;
  LabelSegments: LabelSegmentsResponse;
  LabelShots: LabelShotsResponse;
  LabelSpeaker: LabelSpeakerResponse;
  LabelSpeech: LabelSpeechResponse;
  LabelText: LabelTextResponse;
  LabelTrack: LabelTrackResponse;
  Media: MediaResponse;
  MediaClipLabels: MediaClipLabelsResponse;
  MediaClips: MediaClipsResponse;
  MediaRecommendations: MediaRecommendationsResponse;
  Tasks: TasksResponse;
  TimelineClips: TimelineClipsResponse;
  TimelineRecommendations: TimelineRecommendationsResponse;
  TimelineRenders: TimelineRendersResponse;
  TimelineTracks: TimelineTracksResponse;
  Timelines: TimelinesResponse;
  Uploads: UploadsResponse;
  UsageEvents: UsageEventsResponse;
  Users: UsersResponse;
  WatchFolderImports: WatchFolderImportsResponse;
  WorkspaceMembers: WorkspaceMembersResponse;
  Workspaces: WorkspacesResponse;
  _authOrigins: AuthoriginsResponse;
  _externalAuths: ExternalauthsResponse;
  _mfas: MfasResponse;
  _otps: OtpsResponse;
  _superusers: SuperusersResponse;
};

// Utility types for create/update operations

type ProcessCreateAndUpdateFields<T> = Omit<
  {
    // Omit AutoDate fields
    [K in keyof T as Extract<T[K], IsoAutoDateString> extends never
      ? K
      : never]: T[K] extends infer U // Convert FileNameString to File
      ? U extends FileNameString | FileNameString[]
        ? U extends any[]
          ? File[]
          : File
        : U
      : never;
  },
  'id'
>;

// Create type for Auth collections
export type CreateAuth<T> = {
  id?: RecordIdString;
  email: string;
  emailVisibility?: boolean;
  password: string;
  passwordConfirm: string;
  verified?: boolean;
} & ProcessCreateAndUpdateFields<T>;

// Create type for Base collections
export type CreateBase<T> = {
  id?: RecordIdString;
} & ProcessCreateAndUpdateFields<T>;

// Update type for Auth collections
export type UpdateAuth<T> = Partial<
  Omit<ProcessCreateAndUpdateFields<T>, keyof AuthSystemFields>
> & {
  email?: string;
  emailVisibility?: boolean;
  oldPassword?: string;
  password?: string;
  passwordConfirm?: string;
  verified?: boolean;
};

// Update type for Base collections
export type UpdateBase<T> = Partial<
  Omit<ProcessCreateAndUpdateFields<T>, keyof BaseSystemFields>
>;

// Get the correct create type for any collection
export type Create<T extends keyof CollectionResponses> =
  CollectionResponses[T] extends AuthSystemFields
    ? CreateAuth<CollectionRecords[T]>
    : CreateBase<CollectionRecords[T]>;

// Get the correct update type for any collection
export type Update<T extends keyof CollectionResponses> =
  CollectionResponses[T] extends AuthSystemFields
    ? UpdateAuth<CollectionRecords[T]>
    : UpdateBase<CollectionRecords[T]>;

// Type for usage with type asserted PocketBase instance
// https://github.com/pocketbase/js-sdk#specify-typescript-definitions

export type TypedPocketBase = {
  collection<T extends keyof CollectionResponses>(
    idOrName: T
  ): RecordService<CollectionResponses[T]>;
} & PocketBase;
