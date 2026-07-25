import { select } from '@inquirer/prompts';
import {
  MediaClipMutator,
  MediaMutator,
  TimelineMutator,
  WorkspaceMutator,
  type Directory,
  type Media,
  type MediaClip,
  type Timeline,
  type TypedPocketBase,
  type Upload,
  type Workspace,
} from '@project/shared';
import { updateConfig, loadConfig } from './config.js';
import { fail, formatDuration } from './output.js';
import {
  assertWorkspaceMatch,
  resolveWorkspaceRef,
  workspaceOverride,
} from './workspace-option.js';

/** Media expanded with its source upload (for a human-readable label) and,
 * when one is set, its directory. */
export type MediaWithUpload = Media & {
  expand?: { UploadRef?: Upload; DirectoryRef?: Directory };
};

export function mediaLabel(media: MediaWithUpload): string {
  return media.expand?.UploadRef?.name ?? media.id;
}

/** Interactive workspace picker. */
export async function pickWorkspace(pb: TypedPocketBase): Promise<Workspace> {
  const result = await new WorkspaceMutator(pb).getList(1, 100);
  if (result.items.length === 0) {
    fail('No workspaces found for this account.');
  }
  return select({
    message: 'Choose a workspace:',
    choices: result.items.map((ws) => ({
      name: ws.slug ? `${ws.name} (${ws.slug})` : ws.name,
      value: ws,
      description: ws.id,
    })),
  });
}

/**
 * Resolve the workspace this invocation acts on: the `-w/--workspace` override
 * (accepted on every command — see `lib/workspace-option.ts`) → the selection
 * persisted by `vw workspace use` → the interactive picker (then persisted).
 * An override is used for this invocation only and never persisted.
 */
export async function resolveWorkspaceId(pb: TypedPocketBase): Promise<string> {
  const override = workspaceOverride();
  if (override) return resolveWorkspaceRef(pb, override);

  const cfg = loadConfig();
  if (cfg.workspaceId) return cfg.workspaceId;

  const ws = await pickWorkspace(pb);
  updateConfig({ workspaceId: ws.id, workspaceName: ws.name });
  return ws.id;
}

/**
 * Load a media by id. Records are addressed by globally unique id, so no
 * workspace is needed — but a `-w` that contradicts the record is a mistake,
 * not a redundancy, and is refused here.
 */
export async function requireMedia(
  pb: TypedPocketBase,
  mediaId: string
): Promise<MediaWithUpload> {
  const media = await new MediaMutator(pb).getById(mediaId);
  if (!media) {
    throw new Error(`Media not found: ${mediaId}`);
  }
  await assertWorkspaceMatch(pb, media.WorkspaceRef, `Media ${mediaId}`);
  return media as MediaWithUpload;
}

/** Load a media clip by id, refusing one outside a `-w` override. */
export async function requireMediaClip(
  pb: TypedPocketBase,
  clipId: string
): Promise<MediaClip> {
  const clip = await new MediaClipMutator(pb).getById(clipId);
  if (!clip) {
    throw new Error(`Media clip not found: ${clipId}`);
  }
  await assertWorkspaceMatch(pb, clip.WorkspaceRef, `Media clip ${clipId}`);
  return clip;
}

/** Interactive media picker for a workspace. */
export async function pickMedia(
  pb: TypedPocketBase,
  workspaceId: string
): Promise<MediaWithUpload> {
  const result = await new MediaMutator(pb).getByWorkspace(workspaceId, 1, 200);
  if (result.items.length === 0) {
    fail('No media found in this workspace.');
  }
  return select<MediaWithUpload>({
    message: 'Choose media:',
    choices: result.items.map((media) => ({
      name: `${mediaLabel(media)} — ${media.mediaType} ${formatDuration(media.duration)}`,
      value: media,
      description: media.id,
    })),
  });
}

/** Interactive timeline picker for a workspace. */
export async function pickTimeline(
  pb: TypedPocketBase,
  workspaceId: string
): Promise<Timeline> {
  const result = await new TimelineMutator(pb).getByWorkspace(
    workspaceId,
    1,
    200
  );
  if (result.items.length === 0) {
    fail('No timelines found in this workspace.');
  }
  return select({
    message: 'Choose a timeline:',
    choices: result.items.map((tl) => ({
      name: `${tl.name} — ${formatDuration(tl.duration)}`,
      value: tl,
      description: tl.id,
    })),
  });
}
