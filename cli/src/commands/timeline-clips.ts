import type { Command } from 'commander';
import { TimelineClipMutator } from '@project/shared';
import { handleError, requireClient } from '../lib/run.js';
import { resolveTrackRef } from '../lib/timeline.js';
import {
  clipUpdateOptions,
  moveTimelineClip,
  removeTimelineClip,
  reorderTimelineClips,
  timelineClipLabelHint,
  updateTimelineClip,
  type TimelineClipExpanded,
} from '../lib/timeline-clip.js';
import {
  clipLabelDetail,
  getTimelineOverview,
  type InspectClipInfo,
} from '../lib/timeline-inspect.js';
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
  truncate,
} from '../lib/output.js';
import { printLabelDetail, reportPlacement } from './timeline.js';

const range = (start: number, end: number) =>
  `${start.toFixed(2)}–${end.toFixed(2)}s`;

type ClipRow = InspectClipInfo & { layer: number };

export function registerTimelineClipCommands(timeline: Command): void {
  const clips = timeline
    .command('clips')
    .description('List and edit the clips placed on a timeline');

  withJsonOption(
    clips
      .command('list')
      .alias('ls')
      .description("List a timeline's clips with computed positions")
      .requiredOption('-t, --timeline <id>', 'timeline id')
      .option('--track <layer|id>', 'restrict to one track')
  ).action(async (opts) => {
    try {
      const pb = await requireClient();
      const overview = await getTimelineOverview(pb, opts.timeline);

      let tracks = overview.tracks;
      if (opts.track) {
        const target = await resolveTrackRef(pb, opts.timeline, opts.track);
        tracks = tracks.filter((t) => t.track?.id === target.id);
      }

      const rows: ClipRow[] = tracks.flatMap((t) =>
        t.clips.map((c) => ({ ...c, layer: t.layer }))
      );

      printList(
        rows,
        [
          { header: 'ID', value: (r) => r.clip.id },
          { header: 'TRACK', value: (r) => String(r.layer) },
          { header: 'ORDER', value: (r) => String(r.clip.order) },
          {
            header: 'TIMELINE',
            value: (r) => range(r.timelineStart, r.timelineEnd),
          },
          { header: 'SOURCE', value: (r) => range(r.clip.start, r.clip.end) },
          {
            header: 'DUR',
            value: (r) => formatDuration(r.timelineEnd - r.timelineStart),
          },
          { header: 'KIND', value: (r) => r.kind },
          { header: 'LABEL', value: (r) => truncate(r.labelHint, 40) },
        ],
        {
          json: opts.json,
          totalItems: rows.length,
          hint: '`vw timeline clips show <id>` for one clip',
        }
      );
    } catch (err) {
      handleError(err);
    }
  });

  withJsonOption(
    clips
      .command('show <clipId>')
      .description('Show a timeline clip with its computed placement')
      .option(
        '--labels',
        'include label detail (provenance + overlapping labels)'
      )
  ).action(async (clipId: string, opts) => {
    try {
      const pb = await requireClient();
      const clip = (await new TimelineClipMutator(pb).getById(
        clipId
      )) as TimelineClipExpanded | null;
      if (!clip) {
        throw new Error(`Timeline clip not found: ${clipId}`);
      }

      const overview = await getTimelineOverview(pb, clip.TimelineRef);
      let placement: ClipRow | undefined;
      for (const track of overview.tracks) {
        const found = track.clips.find((c) => c.clip.id === clipId);
        if (found) placement = { ...found, layer: track.layer };
      }

      const labels = opts.labels ? await clipLabelDetail(pb, clip) : undefined;

      if (opts.json) {
        printRecord(
          {
            clip,
            placement: placement
              ? {
                  layer: placement.layer,
                  timelineStart: placement.timelineStart,
                  timelineEnd: placement.timelineEnd,
                  kind: placement.kind,
                  labelHint: placement.labelHint,
                }
              : null,
            ...(labels ? { labels } : {}),
          },
          [],
          true
        );
        return;
      }

      const hint = timelineClipLabelHint(clip);
      const kind = clip.CaptionRef ? 'caption' : 'media';
      info(`Clip ${clip.id} — "${truncate(hint, 40)}" (${kind})`);
      if (placement) {
        const trackName = placement.layer;
        info(
          `  timeline: ${range(placement.timelineStart, placement.timelineEnd)} (track layer ${trackName})`
        );
      }
      info(
        `  source: ${range(clip.start, clip.end)} of ${clip.MediaRef ?? clip.CaptionRef}`
      );
      const gain = clip.meta?.gain;
      info(
        `  order: ${clip.order}${clip.timelineStart !== undefined && clip.timelineStart !== null ? `   pinned at: ${clip.timelineStart.toFixed(2)}s` : '   (sequential)'}${gain !== undefined ? `   gain: ${gain}` : ''}`
      );
      if (clip.description)
        info(`  description: ${truncate(clip.description)}`);
      if (labels) printLabelDetail(labels);
    } catch (err) {
      handleError(err);
    }
  });

  const update = clips
    .command('update <clipId>')
    .description('Update a timeline clip (label, description, trim, gain)');
  applyOptions(withJsonOption(update), clipUpdateOptions).action(
    async (clipId: string, opts) => {
      try {
        const pb = await requireClient();
        const updated = await updateTimelineClip(
          pb,
          clipId,
          pickOptions(opts, clipUpdateOptions)
        );
        if (opts.json) {
          printRecord(updated, [], true);
          return;
        }
        success(
          `Updated clip ${updated.id} (${range(updated.start, updated.end)}, ${formatDuration(updated.duration)})`
        );
      } catch (err) {
        handleError(err);
      }
    }
  );

  withJsonOption(
    clips
      .command('move <clipId>')
      .description('Move a clip to another track and/or timeline position')
      .option('--track <layer|id>', 'destination track (default: current)')
      .option(
        '--at <seconds>',
        'new timeline position (default: keep current position)',
        parseSeconds
      )
      .option(
        '--overwrite',
        'with --at: trim/remove overlapping clips instead of nudging forward'
      )
      .option(
        '--sequential',
        'clear the pinned position so the clip re-flows by order'
      )
  ).action(async (clipId: string, opts) => {
    try {
      const pb = await requireClient();
      const result = await moveTimelineClip(pb, clipId, {
        track: opts.track,
        at: opts.at,
        overwrite: opts.overwrite,
        sequential: opts.sequential,
      });
      if (opts.json) {
        printRecord(result, [], true);
        return;
      }
      success(
        `Moved clip ${result.clip.id} to track layer ${result.track.layer} (${result.track.name})`
      );
      if (opts.sequential) {
        info('  cleared pinned position — clip re-flows sequentially by order');
      }
      reportPlacement(result);
    } catch (err) {
      handleError(err);
    }
  });

  clips
    .command('remove <clipId>')
    .description('Remove a clip from its timeline')
    .action(async (clipId: string) => {
      try {
        const pb = await requireClient();
        const removed = await removeTimelineClip(pb, clipId);
        success(
          `Removed clip ${removed.id} from timeline ${removed.TimelineRef}`
        );
      } catch (err) {
        handleError(err);
      }
    });

  clips
    .command('reorder <clipIds...>')
    .description(
      'Replace the clip order: pass every clip id in the new sequence'
    )
    .requiredOption('-t, --timeline <id>', 'timeline id')
    .action(async (clipIds: string[], opts) => {
      try {
        const pb = await requireClient();
        const reordered = await reorderTimelineClips(
          pb,
          opts.timeline,
          clipIds
        );
        success(
          `Reordered ${reordered.length} clips on timeline ${opts.timeline}`
        );
      } catch (err) {
        handleError(err);
      }
    });
}
