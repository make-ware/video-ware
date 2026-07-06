import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { ListResult } from 'pocketbase';
import {
  LabelType,
  MediaClipMutator,
  MediaMutator,
  TimelineMutator,
  WorkspaceMutator,
  type Media,
  type Timeline,
  type TypedPocketBase,
  type Workspace,
} from '@project/shared';
import { labelMutator, type LabelRecord } from './label.js';
import { mediaLabel, type MediaWithUpload } from './select.js';
import { getTimelineOverview } from './timeline-inspect.js';

/**
 * `vw workspace export`: dump a workspace's media, media clips, labels, and
 * timelines into a directory of JSON files that AI agents can read as
 * context before editing the workspace through the CLI. Everything is
 * fetched through the shared mutators, so the files carry exactly the
 * records the other `vw --json` commands print.
 */

const PER_PAGE = 200;

/** Marks a directory as a previous export, allowing an in-place refresh. */
export const EXPORT_MANIFEST_FILE = 'manifest.json';

/** Entries the exporter owns; a refresh removes exactly these. */
const OWNED_ENTRIES = [
  'INSTRUCTIONS.md',
  EXPORT_MANIFEST_FILE,
  'workspace.json',
  'media',
  'timelines',
];

export interface ExportWorkspaceOptions {
  workspaceId: string;
  /** Target directory; created when missing. */
  dir: string;
  /** Include per-media label data. Defaults to true. */
  labels?: boolean;
  /** Write into a non-empty directory that is not a previous export. */
  force?: boolean;
}

export interface ExportCounts {
  media: number;
  mediaClips: number;
  labels: number;
  timelines: number;
}

/** Written to manifest.json and returned (plus `dir`) as the JSON result. */
export interface ExportManifest {
  exportedAt: string;
  workspace: { id: string; name: string };
  includesLabels: boolean;
  counts: ExportCounts;
}

export interface ExportResult extends ExportManifest {
  dir: string;
}

/** One row of media/index.json. */
export interface MediaIndexEntry {
  id: string;
  name: string;
  label?: string;
  description?: string;
  mediaType: Media['mediaType'];
  duration: number;
  width: number;
  height: number;
  clipCount: number;
  /** Rows per label type; only types with at least one row appear. */
  labelCounts: Partial<Record<LabelType, number>>;
}

/** One row of timelines/index.json. */
export interface TimelineIndexEntry {
  id: string;
  name: string;
  label?: string;
  description?: string;
  orientation?: Timeline['orientation'];
  /** Computed duration (furthest clip end), not the stored field. */
  duration: number;
  trackCount: number;
  clipCount: number;
}

/** Fetch every page of a paginated list. */
async function fetchAll<T>(
  getPage: (page: number) => Promise<ListResult<T>>
): Promise<T[]> {
  const first = await getPage(1);
  const items = [...first.items];
  for (let page = 2; page <= first.totalPages; page++) {
    items.push(...(await getPage(page)).items);
  }
  return items;
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const group = groups.get(k);
    if (group) {
      group.push(item);
    } else {
      groups.set(k, [item]);
    }
  }
  return groups;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** Wrap rows in the `{ items, totalItems }` shape all `--json` lists use. */
function listDoc<T>(items: T[]): { items: T[]; totalItems: number } {
  return { items, totalItems: items.length };
}

/**
 * Reduce a record's `expand` to an explicit whitelist before serializing.
 * Shared mutators attach default relations we don't want in the snapshot — a
 * Media (or a timeline clip's expanded MediaRef) carries its
 * thumbnail/sprite/filmstrip/proxy file records, a Timeline its workspace,
 * render task, and creator. The export owns its own shape, so it decides
 * exactly which relations survive rather than inheriting the mutator
 * defaults. Passing no keys (or matching none) drops `expand` entirely.
 * Returns a shallow copy; the input record is left untouched.
 */
function stripExpand<T>(record: T, keep: readonly string[] = []): T {
  const rec = record as { expand?: Record<string, unknown> } | null;
  if (!rec || typeof rec !== 'object' || !rec.expand) return record;
  const kept: Record<string, unknown> = {};
  for (const key of keep) {
    if (rec.expand[key] !== undefined) kept[key] = rec.expand[key];
  }
  const clone: Record<string, unknown> = { ...(rec as object) };
  if (Object.keys(kept).length > 0) {
    clone.expand = kept;
  } else {
    delete clone.expand;
  }
  return clone as T;
}

/**
 * Make `dir` ready to receive an export. A directory holding a previous
 * export (manifest present) is refreshed in place: the entries the exporter
 * owns are removed so records deleted since the last snapshot don't linger.
 * Any other non-empty directory is refused unless `force` is set.
 */
function prepareExportDir(dir: string, force?: boolean): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    return;
  }
  const entries = readdirSync(dir);
  if (entries.length === 0) return;
  if (!entries.includes(EXPORT_MANIFEST_FILE) && !force) {
    throw new Error(
      `${dir} is not empty and does not look like a previous export ` +
        `(no ${EXPORT_MANIFEST_FILE}) — pass --force to write into it anyway.`
    );
  }
  for (const entry of OWNED_ENTRIES) {
    rmSync(join(dir, entry), { recursive: true, force: true });
  }
}

/**
 * Export one workspace into `opts.dir`. Fetches everything through the
 * shared mutators (all pages), groups clips and labels under their source
 * media, snapshots each timeline via the same overview `timeline show
 * --json` prints, and writes a generated INSTRUCTIONS.md agents should read
 * first. `report` receives one progress line per fetch phase.
 */
export async function exportWorkspace(
  pb: TypedPocketBase,
  opts: ExportWorkspaceOptions,
  report: (message: string) => void = () => {}
): Promise<ExportResult> {
  const includeLabels = opts.labels !== false;

  const workspace = await new WorkspaceMutator(pb).getById(opts.workspaceId);
  if (!workspace) {
    throw new Error(`Workspace not found: ${opts.workspaceId}`);
  }

  prepareExportDir(opts.dir, opts.force);

  // Media, with just the source upload expanded for a human-readable name.
  const mediaMutator = new MediaMutator(pb, { expand: ['UploadRef'] });
  const media = (await fetchAll((page) =>
    mediaMutator.getByWorkspace(opts.workspaceId, page, PER_PAGE)
  )) as MediaWithUpload[];
  report(`Fetched ${media.length} media`);

  // Media clips, raw (their media context is the folder they land in).
  const clips = await fetchAll((page) =>
    new MediaClipMutator(pb, { expand: [] }).getByWorkspace(
      opts.workspaceId,
      page,
      PER_PAGE
    )
  );
  const clipsByMedia = groupBy(clips, (c) => c.MediaRef);
  report(`Fetched ${clips.length} media clips`);

  // Labels: one workspace-wide query per type, grouped under their media.
  const labelTypes = Object.values(LabelType);
  let labelCount = 0;
  const labelsByMedia = new Map<string, Map<LabelType, LabelRecord[]>>();
  if (includeLabels) {
    const wsFilter = pb.filter('WorkspaceRef = {:ws}', {
      ws: opts.workspaceId,
    });
    const perType = await Promise.all(
      labelTypes.map(async (type) => ({
        type,
        rows: await fetchAll((page) =>
          labelMutator(pb, type).getList(page, PER_PAGE, wsFilter, 'start')
        ),
      }))
    );
    for (const { type, rows } of perType) {
      labelCount += rows.length;
      for (const row of rows) {
        let perMedia = labelsByMedia.get(row.MediaRef);
        if (!perMedia) {
          perMedia = new Map();
          labelsByMedia.set(row.MediaRef, perMedia);
        }
        const typed = perMedia.get(type);
        if (typed) {
          typed.push(row);
        } else {
          perMedia.set(type, [row]);
        }
      }
    }
    report(`Fetched ${labelCount} labels across ${labelTypes.length} types`);
  }

  // media/<id>/ folders + index.
  const mediaDir = join(opts.dir, 'media');
  mkdirSync(mediaDir, { recursive: true });
  const mediaIndex: MediaIndexEntry[] = [];
  const knownMedia = new Set(media.map((m) => m.id));
  for (const m of media) {
    const dir = join(mediaDir, m.id);
    mkdirSync(dir, { recursive: true });
    // Keep only UploadRef (its .name is the original filename); drop the
    // thumbnail/sprite/filmstrip/proxy expansions the mutator adds.
    writeJson(join(dir, 'media.json'), stripExpand(m, ['UploadRef']));

    // One file per clip, so every entity is addressable on its own.
    const mediaClips = clipsByMedia.get(m.id) ?? [];
    if (mediaClips.length > 0) {
      const clipsDir = join(dir, 'clips');
      mkdirSync(clipsDir, { recursive: true });
      for (const clip of mediaClips) {
        writeJson(join(clipsDir, `${clip.id}.json`), stripExpand(clip));
      }
    }

    // One file per label, foldered by type (labels/<type>/<id>.json).
    const labelCounts: Partial<Record<LabelType, number>> = {};
    const perMedia = labelsByMedia.get(m.id);
    if (perMedia) {
      for (const [type, rows] of perMedia) {
        labelCounts[type] = rows.length;
        const typeDir = join(dir, 'labels', type);
        mkdirSync(typeDir, { recursive: true });
        for (const row of rows) {
          writeJson(join(typeDir, `${row.id}.json`), stripExpand(row));
        }
      }
    }

    mediaIndex.push({
      id: m.id,
      name: mediaLabel(m),
      ...(m.label !== undefined ? { label: m.label } : {}),
      ...(m.description !== undefined ? { description: m.description } : {}),
      mediaType: m.mediaType,
      duration: m.duration,
      width: m.width,
      height: m.height,
      clipCount: mediaClips.length,
      labelCounts,
    });
  }
  writeJson(join(mediaDir, 'index.json'), listDoc(mediaIndex));

  // Clips/labels whose media no longer exists can't be edited through the
  // CLI — surface them instead of exporting folders without a media.json.
  const orphanSources = [...clipsByMedia.keys(), ...labelsByMedia.keys()];
  const orphans = [...new Set(orphanSources)].filter(
    (id) => !knownMedia.has(id)
  );
  if (orphans.length > 0) {
    report(
      `Skipped clips/labels for ${orphans.length} missing media: ` +
        orphans.join(', ')
    );
  }

  // timelines/<id>.json snapshots + index.
  const timelinesDir = join(opts.dir, 'timelines');
  mkdirSync(timelinesDir, { recursive: true });
  const timelines = await fetchAll((page) =>
    new TimelineMutator(pb, { expand: [] }).getByWorkspace(
      opts.workspaceId,
      page,
      PER_PAGE
    )
  );
  const timelineIndex: TimelineIndexEntry[] = [];
  for (const timeline of timelines) {
    const overview = await getTimelineOverview(pb, timeline.id);
    // getTimelineOverview expands each clip's MediaRef (with its
    // thumbnail/sprite/filmstrip file records) plus the timeline's workspace,
    // render task, and creator for the live `timeline show`. The snapshot
    // wants only the records themselves, so strip every nested expand.
    const snapshot = {
      ...overview,
      timeline: stripExpand(overview.timeline),
      tracks: overview.tracks.map((track) => ({
        ...track,
        track: stripExpand(track.track),
        clips: track.clips.map((info) => ({
          ...info,
          clip: stripExpand(info.clip),
        })),
      })),
    };
    writeJson(join(timelinesDir, `${timeline.id}.json`), snapshot);
    timelineIndex.push({
      id: timeline.id,
      name: timeline.name,
      ...(timeline.label !== undefined ? { label: timeline.label } : {}),
      ...(timeline.description !== undefined
        ? { description: timeline.description }
        : {}),
      ...(timeline.orientation !== undefined
        ? { orientation: timeline.orientation }
        : {}),
      duration: overview.computedDuration,
      trackCount: overview.tracks.length,
      clipCount: overview.clipCount,
    });
  }
  writeJson(join(timelinesDir, 'index.json'), listDoc(timelineIndex));
  report(`Fetched ${timelines.length} timelines`);

  writeJson(join(opts.dir, 'workspace.json'), stripExpand(workspace));

  const manifest: ExportManifest = {
    exportedAt: new Date().toISOString(),
    workspace: { id: workspace.id, name: workspace.name },
    includesLabels: includeLabels,
    counts: {
      media: media.length,
      mediaClips: clips.length,
      labels: labelCount,
      timelines: timelines.length,
    },
  };
  writeJson(join(opts.dir, EXPORT_MANIFEST_FILE), manifest);

  writeFileSync(
    join(opts.dir, 'INSTRUCTIONS.md'),
    buildInstructions({
      workspace,
      manifest,
      exampleMediaId: media[0]?.id,
      exampleTimelineId: timelines[0]?.id,
    })
  );

  return { dir: opts.dir, ...manifest };
}

/** The agent-facing guide written to INSTRUCTIONS.md on every export. */
function buildInstructions(params: {
  workspace: Workspace;
  manifest: ExportManifest;
  exampleMediaId?: string;
  exampleTimelineId?: string;
}): string {
  const { workspace, manifest } = params;
  const { counts } = manifest;
  const mediaId = params.exampleMediaId ?? 'MEDIA_ID';
  const timelineId = params.exampleTimelineId ?? 'TIMELINE_ID';
  const labelsLine = manifest.includesLabels
    ? `${counts.labels} labels`
    : 'labels skipped (--no-labels)';

  return `# Workspace export: ${workspace.name}

Read-only snapshot of the video-ware workspace **${workspace.name}**
(\`${workspace.id}\`), exported ${manifest.exportedAt} by
\`vw workspace export\`. Contents: ${counts.media} media,
${counts.mediaClips} media clips, ${labelsLine},
${counts.timelines} timelines.

**These files are a snapshot, not the live workspace.** Editing them changes
nothing. To change the workspace, run \`vw\` commands (below), then re-run
\`vw workspace export <this directory>\` to refresh — records deleted since
the last export are cleaned up automatically.

## Layout

\`\`\`
INSTRUCTIONS.md         this file
manifest.json           what was exported, when, and how much
workspace.json          the Workspace record
media/
  index.json            one row per media: name, type, duration, clipCount,
                        labelCounts — scan this first
  <mediaId>/
    media.json          the Media record (expand.UploadRef.name is the
                        original filename)
    clips/<clipId>.json one MediaClip cut from this media, per file
                        (folder absent = no clips)
    labels/<type>/<labelId>.json
                        one label per file, foldered by type (a type
                        folder is absent when it has no labels)
timelines/
  index.json            one row per timeline: name, duration, trackCount,
                        clipCount
  <timelineId>.json     full structure: tracks (layer-ordered) with placed
                        clips
\`\`\`

Every entity is its own file: \`media.json\`, each \`clips/<id>.json\`, each
\`labels/<type>/<id>.json\`, and each \`timelines/<id>.json\` hold a single
record — the same document \`vw ... --json\` prints for that record. The
\`index.json\` files instead have the shape \`{ "items": [...], "totalItems":
N }\`. All times are seconds.

## Data model

- **Media** — a source video/audio/image file. \`duration\`, \`width\`,
  \`height\` describe the source.
- **MediaClip** — a reusable, named sub-range of one media; \`start\`/\`end\`
  are positions in the source media. Created by hand
  (\`vw media clip create\`) or from a label (\`vw label clip\`).
- **Labels** — machine annotations of a media, one file per label under a
  per-type folder: \`speech\` (transcripts), \`speaker\` (diarized
  per-speaker utterances; each carries a \`speakerId\` and word timings),
  \`text\` (on-screen text), \`object\`, \`shot\`, \`segment\`, \`person\`,
  \`face\`. Each carries \`start\`/\`end\` in source-media seconds plus a
  confidence. Search them for moments worth turning into clips.
- **Timeline** — an edit. \`timelines/<id>.json\` holds
  \`{ timeline, computedDuration, clipCount, tracks }\`; \`tracks\` are
  ordered by \`layer\` (0 = bottom of the visual stack, at most 4). Each
  track's clips carry computed \`timelineStart\`/\`timelineEnd\` (position on
  the timeline) while \`clip.start\`/\`clip.end\` are the trim window in the
  source media.

Timeline placement semantics: every clip sits at an explicit
\`timelineStart\`. \`vw timeline insert\` appends to the end of the target
track by default; \`--after <clipId>\` places right after that clip and
\`--at <seconds>\` places at an exact time. Clips on the same track never
overlap — \`--at\` placements nudge forward past collisions unless
\`--overwrite\` trims/removes what is in the way. \`vw timeline clips
ripple <id> --by <±s>\` shifts a clip and everything after it, and
\`vw timeline doctor <id>\` verifies the result (overlaps, gaps, stale
durations).

## Editing the workspace with vw

Ids in these files (folder names, \`id\` fields) plug directly into \`vw\`
flags. Always pass explicit ids and \`-w ${workspace.id}\` — commands fall
back to interactive pickers when an id is omitted, which blocks without a
TTY. Add \`--json\` for machine-readable output.

\`\`\`bash
# 1. Find moments and turn the good ones into MediaClips
vw label search "sunset" -w ${workspace.id} --min-confidence 0.8 --json
vw label clip speech LABEL_ID --label "Intro quote"
vw media clip create -m ${mediaId} -s 5 -e 12.5 --label "Opening shot"

# 2. Create a timeline and organize tracks (layer 0 = bottom)
vw timeline create "Episode 4" -w ${workspace.id} --tracks "Music,AV,B-Roll"
vw timeline track update 0 -t ${timelineId} --volume 0.4   # duck the music

# 3. Insert media or MediaClips (appends to the track unless --at/--after)
vw timeline insert -t ${timelineId} --clips MEDIACLIP_ID,MEDIACLIP_ID2 --track 1
vw timeline insert -t ${timelineId} -m ${mediaId} --track 2 --at 12.5

# 4. Verify and fine-tune
vw timeline show ${timelineId} --json
vw timeline doctor ${timelineId}
vw timeline inspect -t ${timelineId} --at 14 --labels
vw timeline clips move CLIP_ID --at 16 --overwrite
vw timeline clips ripple CLIP_ID --by=-2.5   # pull this clip + later ones left

# 5. Render, then refresh this snapshot
vw timeline render -t ${timelineId} --download out.mp4
vw workspace export <this directory> -w ${workspace.id}
\`\`\`

Run \`vw --help\` (or \`vw timeline --help\`) for the full command list.
`;
}
