// Shared TypeScript types

import PocketBase from 'pocketbase';
import type { RecordService } from 'pocketbase';
import type { User } from '../schema/user';
import type { Task } from '../schema/task';
import type { MediaClip } from '../schema/media-clip';
import type { MediaClipLabel } from '../schema/media-clip-label';
import type { Upload } from '../schema/upload';
import type { File } from '../schema/file';
import type { Directory } from '../schema/directory';
import type { Media } from '../schema/media';
import type { Workspace } from '../schema/workspace';
import type { WorkspaceMember } from '../schema/workspace-member';
import type { Timeline } from '../schema/timeline';
import type { Caption } from '../schema/caption';
import type { ClipLabelSearch } from '../schema/clip-label-search';
import type { TimelineClip } from '../schema/timeline-clip';
import type { TimelineRender } from '../schema/timeline-render';
import type { LabelEntity } from '../schema/label-entity';
import type { Entity } from '../schema/entity';
import type { EntityStats } from '../schema/entity-stats';
import type { Artifact } from '../schema/artifact';
import { LabelTrack } from '../schema/label-track';
import { LabelSpeaker } from '../schema/label-speaker';
import { LabelSpeech } from '../schema/label-speech';
import { LabelFace } from '../schema/label-face';
import { LabelPerson } from '../schema/label-person';
import { LabelSegment } from '../schema/label-segment';
import { LabelShot } from '../schema/label-shot';
import { LabelText } from '../schema/label-text';
import { LabelObject } from '../schema/label-objects';
import { UsageEvent } from '../schema/usage-events';
import { TimelineTrackRecord } from '../schema/timeline-track';
import { LabelJob } from '../schema/label-job';

export * from './video-ware.js';
export * from './task-contracts.js';
export * from './captions.js';
export * from './processor.js';
export * from './label-data.js';
export * from './raw-label-cache.js';
export * from './metadata.js';
export * from './relations.js';

// Typed PocketBase interface
export interface TypedPocketBase extends PocketBase {
  collection(idOrName: 'Artifacts'): RecordService<Artifact>;
  collection(idOrName: 'Captions'): RecordService<Caption>;
  collection(idOrName: 'ClipLabelSearch'): RecordService<ClipLabelSearch>;
  collection(idOrName: 'Directories'): RecordService<Directory>;
  collection(idOrName: 'Entities'): RecordService<Entity>;
  collection(idOrName: 'EntityStats'): RecordService<EntityStats>;
  collection(idOrName: 'Files'): RecordService<File>;
  collection(idOrName: 'LabelEntity'): RecordService<LabelEntity>;
  collection(idOrName: 'LabelFaces'): RecordService<LabelFace>;
  collection(idOrName: 'LabelJobs'): RecordService<LabelJob>;
  collection(idOrName: 'LabelObjects'): RecordService<LabelObject>;
  collection(idOrName: 'LabelPerson'): RecordService<LabelPerson>;
  collection(idOrName: 'LabelSegments'): RecordService<LabelSegment>;
  collection(idOrName: 'LabelShots'): RecordService<LabelShot>;
  collection(idOrName: 'LabelSpeaker'): RecordService<LabelSpeaker>;
  collection(idOrName: 'LabelSpeech'): RecordService<LabelSpeech>;
  collection(idOrName: 'LabelText'): RecordService<LabelText>;
  collection(idOrName: 'LabelTrack'): RecordService<LabelTrack>;
  collection(idOrName: 'Media'): RecordService<Media>;
  collection(idOrName: 'MediaClipLabels'): RecordService<MediaClipLabel>;
  collection(idOrName: 'MediaClips'): RecordService<MediaClip>;
  collection(idOrName: 'Tasks'): RecordService<Task>;
  collection(idOrName: 'TimelineClips'): RecordService<TimelineClip>;
  collection(idOrName: 'TimelineRenders'): RecordService<TimelineRender>;
  collection(idOrName: 'Timelines'): RecordService<Timeline>;
  collection(idOrName: 'TimelineTracks'): RecordService<TimelineTrackRecord>;
  collection(idOrName: 'Uploads'): RecordService<Upload>;
  collection(idOrName: 'UsageEvents'): RecordService<UsageEvent>;
  collection(idOrName: 'Users'): RecordService<User>;
  collection(idOrName: 'WorkspaceMembers'): RecordService<WorkspaceMember>;
  collection(idOrName: 'Workspaces'): RecordService<Workspace>;
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
