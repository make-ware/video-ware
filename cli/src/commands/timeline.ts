import type { Command } from 'commander';
import { TaskStatus, TimelineMutator } from '@project/shared';
import { handleError, requireClient } from '../lib/run.js';
import { pickMedia, pickTimeline, resolveWorkspaceId } from '../lib/select.js';
import {
  createRender,
  createTimeline,
  insertClip,
  insertOptions,
  timelineCreateOptions,
  timelineUpdateOptions,
  updateTimeline,
  type InsertClipResult,
} from '../lib/timeline.js';
import {
  clipLabelDetail,
  getTimelineOverview,
  inspectAtTime,
  type ClipLabelDetail,
  type InspectClipInfo,
  type TrackAtTime,
  type TrackOverview,
} from '../lib/timeline-inspect.js';
import { LABEL_TYPE_CONFIG, confidenceOf } from '../lib/label.js';
import {
  buildRenderConfig,
  downloadRender,
  pollRender,
  renderFileUrl,
} from '../lib/render.js';
import {
  applyOptions,
  parseSeconds,
  pickOptions,
  withJsonOption,
} from '../lib/options.js';
import {
  formatDuration,
  info,
  printList,
  printRecord,
  success,
  table,
  truncate,
} from '../lib/output.js';
import { registerTimelineTrackCommands } from './timeline-track.js';
import { registerTimelineClipCommands } from './timeline-clips.js';

/** Format a time position/range in exact seconds (agents need precision). */
const secs = (v: number) => `${v.toFixed(2)}s`;
const range = (start: number, end: number) =>
  `${start.toFixed(2)}–${end.toFixed(2)}s`;

function trackHeaderLine(overview: TrackOverview): string {
  const track = overview.track;
  if (!track) {
    return `TRACK ${overview.layer}  (implicit — clips without a track)`;
  }
  const parts = [
    `TRACK ${track.layer}`,
    track.name ?? '',
    track.label ? `(${truncate(track.label, 30)})` : '',
    track.id,
    `vol ${track.volume.toFixed(2)}`,
    `opacity ${track.opacity.toFixed(2)}`,
    track.isMuted ? '[muted]' : '',
    track.isLocked ? '[locked]' : '',
  ];
  return parts.filter(Boolean).join('  ');
}

const showClipColumns = [
  { header: 'CLIP', value: (c: InspectClipInfo) => c.clip.id },
  {
    header: 'TIMELINE',
    value: (c: InspectClipInfo) => range(c.timelineStart, c.timelineEnd),
  },
  {
    header: 'SOURCE',
    value: (c: InspectClipInfo) => range(c.clip.start, c.clip.end),
  },
  {
    header: 'DUR',
    value: (c: InspectClipInfo) =>
      formatDuration(c.timelineEnd - c.timelineStart),
  },
  { header: 'KIND', value: (c: InspectClipInfo) => c.kind },
  {
    header: 'LABEL',
    value: (c: InspectClipInfo) => truncate(c.labelHint, 40),
  },
];

/** Print an insert/move placement report under the success line. */
export function reportPlacement(result: {
  placedAt?: number;
  requestedAt?: number;
  nudged: boolean;
  trimmedClipIds: string[];
  removedClipIds: string[];
}): void {
  if (result.placedAt !== undefined) {
    const requested =
      result.nudged && result.requestedAt !== undefined
        ? ` (requested ${secs(result.requestedAt)} — nudged past existing clips)`
        : '';
    info(`  placed at ${secs(result.placedAt)}${requested}`);
  }
  if (result.trimmedClipIds.length > 0) {
    info(`  trimmed: ${result.trimmedClipIds.join(', ')}`);
  }
  if (result.removedClipIds.length > 0) {
    info(`  removed: ${result.removedClipIds.join(', ')}`);
  }
}

/** Print the `--labels` detail lines for one clip. */
export function printLabelDetail(detail: ClipLabelDetail): void {
  if (detail.provenance.length > 0) {
    info('  provenance (labels this clip was created from):');
    for (const p of detail.provenance) {
      const conf = p.confidence !== undefined ? p.confidence.toFixed(2) : '—';
      info(
        `    ${p.type}  ${p.labelId}  conf ${conf}  ${truncate(p.snippet, 50)}`
      );
    }
  }
  if (detail.overlapping.length > 0) {
    info('  overlapping labels in the source window:');
    for (const hit of detail.overlapping) {
      const r = hit.record;
      const snippet = LABEL_TYPE_CONFIG[hit.type].snippet(r);
      info(
        `    ${hit.type}  ${r.id}  ${range(r.start, r.end)}  conf ${confidenceOf(hit).toFixed(2)}  ${truncate(snippet, 50)}`
      );
    }
  }
  if (detail.provenance.length === 0 && detail.overlapping.length === 0) {
    info('  (no labels found for this clip)');
  }
}

export function registerTimelineCommands(program: Command): void {
  const timeline = program
    .command('timeline')
    .alias('tl')
    .description('Work with timelines');

  withJsonOption(
    timeline
      .command('list')
      .alias('ls')
      .description('List timelines in the active workspace')
      .option('-w, --workspace <id>', 'workspace id override')
  ).action(async (opts) => {
    try {
      const pb = await requireClient();
      const workspaceId = await resolveWorkspaceId(pb, opts.workspace);
      const result = await new TimelineMutator(pb).getByWorkspace(
        workspaceId,
        1,
        200
      );
      printList(
        result.items,
        [
          { header: 'ID', value: (t) => t.id },
          { header: 'NAME', value: (t) => t.name },
          { header: 'LABEL', value: (t) => truncate(t.label ?? '', 30) },
          { header: 'DURATION', value: (t) => formatDuration(t.duration) },
          { header: 'VERSION', value: (t) => String(t.version ?? 1) },
        ],
        {
          json: opts.json,
          totalItems: result.totalItems,
          hint: '`vw timeline show <id>` for tracks and clips',
        }
      );
    } catch (err) {
      handleError(err);
    }
  });

  const create = timeline
    .command('create <name>')
    .description('Create a timeline with its tracks')
    .option('-w, --workspace <id>', 'workspace id override');
  applyOptions(withJsonOption(create), timelineCreateOptions).action(
    async (name: string, opts) => {
      try {
        const pb = await requireClient();
        const workspaceId = await resolveWorkspaceId(pb, opts.workspace);
        const created = await createTimeline(pb, {
          workspaceId,
          name,
          ...pickOptions(opts, timelineCreateOptions),
        });
        if (opts.json) {
          printRecord(created, [], true);
          return;
        }
        success(`Created timeline ${created.timeline.id} "${name}"`);
        for (const track of created.tracks) {
          info(`  track layer ${track.layer}: ${track.name} (${track.id})`);
        }
      } catch (err) {
        handleError(err);
      }
    }
  );

  const update = timeline
    .command('update <timelineId>')
    .description('Update a timeline (name, label, description, orientation)');
  applyOptions(withJsonOption(update), timelineUpdateOptions).action(
    async (timelineId: string, opts) => {
      try {
        const pb = await requireClient();
        const updated = await updateTimeline(
          pb,
          timelineId,
          pickOptions(opts, timelineUpdateOptions)
        );
        if (opts.json) {
          printRecord(updated, [], true);
          return;
        }
        success(`Updated timeline ${updated.id} "${updated.name}"`);
      } catch (err) {
        handleError(err);
      }
    }
  );

  withJsonOption(
    timeline
      .command('show <timelineId>')
      .description('Inspect a timeline: tracks, settings, and placed clips')
  ).action(async (timelineId: string, opts) => {
    try {
      const pb = await requireClient();
      const overview = await getTimelineOverview(pb, timelineId);
      if (opts.json) {
        printRecord(overview, [], true);
        return;
      }

      const t = overview.timeline;
      info(
        `Timeline ${t.id} "${t.name}" — ${overview.tracks.length} track(s), ` +
          `${overview.clipCount} clip(s), ${formatDuration(overview.computedDuration)}`
      );
      const meta = [
        t.label ? `label: ${truncate(t.label, 40)}` : '',
        t.orientation ? `orientation: ${t.orientation}` : '',
        `version: ${t.version ?? 1}`,
      ].filter(Boolean);
      info(`  ${meta.join('    ')}`);
      if (t.description) info(`  description: ${truncate(t.description)}`);
      if (t.duration !== overview.computedDuration) {
        info(
          `  (stored duration ${formatDuration(t.duration)} is stale — it syncs on the next clip edit)`
        );
      }

      for (const trackOverview of overview.tracks) {
        info('');
        info(trackHeaderLine(trackOverview));
        table(trackOverview.clips, showClipColumns);
      }
      info('');
      info(
        `(add --json for full records; \`vw timeline inspect -t ${t.id} --at <seconds>\` shows what plays at a moment)`
      );
    } catch (err) {
      handleError(err);
    }
  });

  withJsonOption(
    timeline
      .command('inspect')
      .description('Show what plays on each track at a timeline time')
      .option('-w, --workspace <id>', 'workspace id override')
      .option('-t, --timeline <id>', 'timeline id')
      .requiredOption(
        '--at <seconds>',
        'timeline time to inspect',
        parseSeconds
      )
      .option('--track <layer|id>', 'restrict to one track')
      .option(
        '--labels',
        'include label detail per active clip (provenance + overlapping labels)'
      )
  ).action(async (opts) => {
    try {
      const pb = await requireClient();
      const workspaceId = await resolveWorkspaceId(pb, opts.workspace);
      const timelineId =
        opts.timeline ?? (await pickTimeline(pb, workspaceId)).id;

      const result = await inspectAtTime(pb, {
        timelineId,
        at: opts.at,
        track: opts.track,
      });

      const labelDetails = new Map<string, ClipLabelDetail>();
      if (opts.labels) {
        for (const track of result.tracks) {
          if (track.active) {
            labelDetails.set(
              track.active.clip.id,
              await clipLabelDetail(pb, track.active.clip)
            );
          }
        }
      }

      if (opts.json) {
        printRecord(
          {
            ...result,
            tracks: result.tracks.map((track) => ({
              ...track,
              active: track.active
                ? {
                    ...track.active,
                    ...(opts.labels
                      ? { labels: labelDetails.get(track.active.clip.id) }
                      : {}),
                  }
                : null,
            })),
          },
          [],
          true
        );
        return;
      }

      info(`At ${secs(result.at)} of ${secs(result.computedDuration)}:`);
      table(result.tracks, [
        { header: 'LAYER', value: (t: TrackAtTime) => String(t.layer) },
        {
          header: 'TRACK',
          value: (t: TrackAtTime) =>
            `${truncate(t.trackName, 20)}${t.isMuted ? ' [muted]' : ''}`,
        },
        {
          header: 'CLIP',
          value: (t: TrackAtTime) => t.active?.clip.id ?? '—',
        },
        {
          header: 'LABEL',
          value: (t: TrackAtTime) =>
            t.active ? truncate(t.active.labelHint, 30) : '(empty)',
        },
        {
          header: 'TIMELINE',
          value: (t: TrackAtTime) =>
            t.active
              ? range(t.active.timelineStart, t.active.timelineEnd)
              : '—',
        },
        {
          header: 'SOURCE@T',
          value: (t: TrackAtTime) =>
            t.active ? secs(t.active.sourceTime) : '—',
        },
        {
          header: 'REMAINING',
          value: (t: TrackAtTime) =>
            t.active ? secs(t.active.remaining) : '—',
        },
        {
          header: 'NEXT',
          value: (t: TrackAtTime) =>
            t.nextStart !== null ? secs(t.nextStart) : '—',
        },
      ]);
      if (result.at >= result.computedDuration) {
        info(
          `(${secs(opts.at)} is at or beyond the computed duration — all tracks idle)`
        );
      }

      if (opts.labels) {
        for (const track of result.tracks) {
          if (!track.active) continue;
          info('');
          info(
            `TRACK ${track.layer} ${track.trackName} — labels for ${track.active.clip.id} (${truncate(track.active.labelHint, 40)}):`
          );
          printLabelDetail(labelDetails.get(track.active.clip.id)!);
        }
      }
    } catch (err) {
      handleError(err);
    }
  });

  const insert = timeline
    .command('insert')
    .description('Insert media or a MediaClip into a timeline track')
    .option('-w, --workspace <id>', 'workspace id override')
    .option('-t, --timeline <id>', 'timeline id')
    .option(
      '--overwrite',
      'with --at: trim/remove overlapping clips instead of nudging forward'
    );
  applyOptions(withJsonOption(insert), insertOptions).action(async (opts) => {
    try {
      const pb = await requireClient();
      const workspaceId = await resolveWorkspaceId(pb, opts.workspace);

      const timelineId =
        opts.timeline ?? (await pickTimeline(pb, workspaceId)).id;

      const picked = pickOptions(opts, insertOptions);
      if (!picked.media && !picked.clip) {
        picked.media = (await pickMedia(pb, workspaceId)).id;
      }

      const result: InsertClipResult = await insertClip(pb, {
        timelineId,
        overwrite: opts.overwrite,
        ...picked,
      });

      if (opts.json) {
        printRecord(result, [], true);
        return;
      }
      success(
        `Inserted clip ${result.clip.id} (order ${result.clip.order}, ${formatDuration(result.clip.duration)}) into timeline ${timelineId}`
      );
      reportPlacement(result);
    } catch (err) {
      handleError(err);
    }
  });

  timeline
    .command('render')
    .description('Render a timeline')
    .option('-w, --workspace <id>', 'workspace id override')
    .option('-t, --timeline <id>', 'timeline id')
    .option('--format <fmt>', 'output container format (default: mp4)')
    .option('--codec <codec>', 'video codec (default: h264)')
    .option('--resolution <WxH>', 'output resolution, e.g. 1920x1080')
    .option('--width <px>', 'output width (use with --height)')
    .option('--height <px>', 'output height (use with --width)')
    .option('--no-wait', 'enqueue and exit without polling for completion')
    .option(
      '--timeout <seconds>',
      'max seconds to wait for completion before giving up (default: 1800)'
    )
    .option('--download <path>', 'download the output file on success')
    .action(async (opts) => {
      try {
        const pb = await requireClient();
        const workspaceId = await resolveWorkspaceId(pb, opts.workspace);

        let timelineId = opts.timeline as string | undefined;
        if (!timelineId) {
          timelineId = (await pickTimeline(pb, workspaceId)).id;
        }

        const outputSettings = buildRenderConfig({
          resolution: opts.resolution,
          width: opts.width,
          height: opts.height,
          codec: opts.codec,
          format: opts.format,
        });

        const render = await createRender(pb, { timelineId, outputSettings });
        success(`Render queued: ${render.id}`);

        if (opts.wait === false) {
          info('Skipping wait — poll status with the webapp or re-run later.');
          return;
        }

        let maxWaitMs: number | undefined;
        if (opts.timeout !== undefined) {
          const seconds = Number(opts.timeout);
          if (!Number.isFinite(seconds) || seconds <= 0) {
            throw new Error('--timeout must be a positive number of seconds.');
          }
          maxWaitMs = seconds * 1000;
        }

        const final = await pollRender(pb, render.id, {
          maxWaitMs,
          onUpdate: (status, progress) => info(`  ${status} (${progress}%)`),
        });

        if (final.status === TaskStatus.SUCCESS) {
          const url = renderFileUrl(pb, final);
          success(
            `Render complete. ${url ? `Output: ${url}` : 'Output stored externally (S3/GCS).'}`
          );
          if (opts.download) {
            await downloadRender(pb, final, opts.download);
            success(`Saved to ${opts.download}`);
          }
        } else {
          handleError(
            new Error(
              `Render ${final.status}: ${final.errorLog ?? 'no details'}`
            )
          );
        }
      } catch (err) {
        handleError(err);
      }
    });

  registerTimelineTrackCommands(timeline);
  registerTimelineClipCommands(timeline);
}
