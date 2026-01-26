// Shared TypeScript types

import PocketBase from 'pocketbase';
import type { RecordService } from 'pocketbase';
import type { User } from '../schema/user';
import type { Task } from '../schema/task';
import type { MediaClip } from '../schema/media-clip';
import type { Upload } from '../schema/upload';
import type { File } from '../schema/file';
import type { Media } from '../schema/media';
import type { Workspace } from '../schema/workspace';
import type { WorkspaceMember } from '../schema/workspace-member';
import type { Timeline } from '../schema/timeline';
import type { TimelineClip } from '../schema/timeline-clip';
import type { TimelineRender } from '../schema/timeline-render';
import type { WatchedFile } from '../schema/watched-file';
import type { LabelEntity } from '../schema/label-entity';
import { LabelTrack } from '../schema/label-track';
import { MediaRecommendation } from '../schema/media-recommendation';
import { TimelineRecommendation } from '../schema/timeline-recommendation';
import { LabelSpeech } from '../schema/label-speech';
import { LabelFace } from '../schema/label-face';
import { LabelPerson } from '../schema/label-person';
import { LabelSegment } from '../schema/label-segment';
import { LabelShot } from '../schema/label-shot';
import { LabelObject } from '../schema/label-objects';
import { UsageEvent } from '../schema/usage-events';
import { TimelineTrack } from './task-contracts.js';
import { LabelJob } from '../schema/label-job';

export * from './video-ware.js';
export * from './task-contracts.js';
export * from './processor.js';
export * from './label-data.js';
export * from './raw-label-cache.js';
export * from './metadata.js';
export * from './relations.js';

// Typed PocketBase interface
export interface TypedPocketBase extends PocketBase {
  collection(idOrName: 'Files'): RecordService<File>;
  collection(idOrName: 'LabelShots'): RecordService<LabelShot>;
  collection(idOrName: 'LabelSegments'): RecordService<LabelSegment>;
  collection(idOrName: 'LabelFaces'): RecordService<LabelFace>;
  collection(idOrName: 'LabelEntity'): RecordService<LabelEntity>;
  collection(idOrName: 'LabelPerson'): RecordService<LabelPerson>;
  collection(idOrName: 'LabelSpeech'): RecordService<LabelSpeech>;
  collection(idOrName: 'LabelTrack'): RecordService<LabelTrack>;
  collection(idOrName: 'LabelObjects'): RecordService<LabelObject>;
  collection(idOrName: 'Media'): RecordService<Media>;
  collection(idOrName: 'MediaClips'): RecordService<MediaClip>;
  collection(
    idOrName: 'MediaRecommendations'
  ): RecordService<MediaRecommendation>;
  collection(idOrName: 'Tasks'): RecordService<Task>;
  collection(idOrName: 'TimelineClips'): RecordService<TimelineClip>;
  collection(idOrName: 'TimelineRenders'): RecordService<TimelineRender>;
  collection(
    idOrName: 'TimelineRecommendations'
  ): RecordService<TimelineRecommendation>;
  collection(idOrName: 'Timelines'): RecordService<Timeline>;
  collection(idOrName: 'Uploads'): RecordService<Upload>;
  collection(idOrName: 'Users'): RecordService<User>;
  collection(idOrName: 'WatchedFiles'): RecordService<WatchedFile>;
  collection(idOrName: 'WorkspaceMembers'): RecordService<WorkspaceMember>;
  collection(idOrName: 'Workspaces'): RecordService<Workspace>;
  collection(idOrName: 'UsageEvents'): RecordService<UsageEvent>;
  collection(idOrName: 'TimelineTracks'): RecordService<TimelineTrack>;
  collection(idOrName: 'LabelJobs'): RecordService<LabelJob>;
}

// PocketBase response types
export interface PocketBaseResponse<T = Record<string, unknown>> {
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
  items: T[];
}

// API response types
export interface ApiResponse<T = Record<string, unknown>> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// Common utility types
export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
export type RequiredFields<T, K extends keyof T> = T & Required<Pick<T, K>>;
