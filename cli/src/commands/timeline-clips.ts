import type { Command } from 'commander';
import { TimelineClipMutator } from '@project/shared';
import { handleError, requireClient } from '../lib/run.js';
import { resolveTrackRef } from '../lib/timeline.js';
import {
  clipUpdateOptions,
  moveTimelineClip,
  removeTimelineClip,
  reorderTimelineClips,
  rippleTimelineClips,
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
  parseSignedSeconds,
  pickOptions,
  withForceOption,
  withJsonOption,
  withStrictOption,
} from '../lib/options.js';
import {
  formatDuration,
  info,
  printList,
  printRecord,
  success,
  truncate,
} from '../lib/output.js';
import { withConflictRetry } from '../lib/conflict.js';
import {
  enforceStrict,
  noopMessage,
  printOpWarnings,
} from '../lib/warnings.js';
import { registerTimelineClipSegmentCommands } from './clip-segments.js';
import { printLabelDetail, reportPlacement } from './timeline.js';

const range = (start: number, end: number) =>
  `${start.toFixed(2)}–${end.toFixed(2)}s`;
const secs = (v: number) => `${v.toFixed(2)}s`;

/** `-w` is accepted on every clip command so agents can pass it uniformly. */
const workspaceOption = (cmd: Command): Command =>
  cmd.option(
    '-w, --workspace <id>',
    'workspace id (accepted for flag consistency; clips are addressed by id)'
  );

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
      .option('-w, --workspace <id>', 'workspace id (validated when passed)')
      .option('--track <layer|id>', 'restrict to one track')
  ).action(async (opts) => {
    try {
      const pb = await requireClient();
      const overview = await getTimelineOverview(pb, opts.timeline);
      if (opts.workspace && overview.timeline.WorkspaceRef !== opts.workspace) {
        throw new Error(
          `Timeline ${opts.timeline} belongs to workspace ${overview.timeline.WorkspaceRef}, not ${opts.workspace}.`
        );
      }

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
    workspaceOption(
      clips
        .command('show <clipId>')
        .description('Show a timeline clip with its computed placement')
        .option('-t, --timeline <id>', 'timeline id (validated when passed)')
        .option(
          '--labels',
          'include label detail (provenance + overlapping labels)'
        )
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
      if (opts.timeline && clip.TimelineRef !== opts.timeline) {
        throw new Error(
          `Clip ${clipId} belongs to timeline ${clip.TimelineRef}, not ${opts.timeline}.`
        );
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
      const kind = clip.CaptionRef
        ? 'caption'
        : clip.SourceTimelineRef
          ? 'timeline'
          : 'media';
      info(`Clip ${clip.id} — "${truncate(hint, 40)}" (${kind})`);
      if (placement) {
        const trackName = placement.layer;
        info(
          `  timeline: ${range(placement.timelineStart, placement.timelineEnd)} (track layer ${trackName})`
        );
      }
      info(
        `  source: ${range(clip.start, clip.end)} of ${
          clip.MediaRef ?? clip.CaptionRef ?? clip.SourceTimelineRef
        }`
      );
      const gain = clip.meta?.gain;
      const stored =
        clip.timelineStart !== undefined && clip.timelineStart !== null
          ? `   timelineStart: ${secs(clip.timelineStart)}`
          : '   (no stored position — legacy clip; `clips move` pins it)';
      info(
        `  order: ${clip.order}${stored}${gain !== undefined ? `   gain: ${gain}` : ''}`
      );
      if (clip.description)
        info(`  description: ${truncate(clip.description)}`);
      if (labels) printLabelDetail(labels);
    } catch (err) {
      handleError(err);
    }
  });

  const update = withForceOption(
    withStrictOption(
      workspaceOption(
        clips
          .command('update <clipId>')
          .description(
            'Update a timeline clip (label, description, trim, gain)'
          )
          .option('-t, --timeline <id>', 'timeline id (validated when passed)')
      )
    )
  );
  applyOptions(withJsonOption(update), clipUpdateOptions).action(
    async (clipId: string, opts) => {
      try {
        const pb = await requireClient();
        const picked = pickOptions(opts, clipUpdateOptions);
        const patchKeys = [
          ...(picked.label !== undefined ? ['label'] : []),
          ...(picked.description !== undefined ? ['description'] : []),
          ...(picked.start !== undefined || picked.end !== undefined
            ? ['start', 'end', 'duration']
            : []),
          ...(picked.gain !== undefined ? ['meta'] : []),
        ];
        const result = await withConflictRetry(
          () =>
            updateTimelineClip(pb, clipId, {
              ...picked,
              ...(opts.timeline ? { timelineId: opts.timeline } : {}),
            }),
          { patchKeys, force: opts.force }
        );
        if (opts.json) {
          printRecord(result, [], true);
        } else if (result.noop) {
          info(noopMessage(result.warnings) ?? 'Nothing to write.');
        } else {
          success(
            `Updated clip ${result.clip.id} (${range(result.clip.start, result.clip.end)}, ${formatDuration(result.clip.duration)})`
          );
        }
        printOpWarnings(result.warnings);
        enforceStrict(result.warnings, opts.strict);
      } catch (err) {
        handleError(err);
      }
    }
  );

  withJsonOption(
    withForceOption(
      withStrictOption(
        workspaceOption(
          clips
            .command('move <clipId>')
            .description(
              'Move a clip to another track and/or timeline position'
            )
            .option(
              '-t, --timeline <id>',
              'timeline id (validated when passed)'
            )
            .option(
              '--track <layer|id>',
              'destination track (default: current)'
            )
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
              '--ripple',
              'land at the exact time and shift later clips right to make room'
            )
            .option(
              '--dry-run',
              'print the placement plan without writing anything'
            )
        )
      )
    )
  ).action(async (clipId: string, opts) => {
    try {
      const pb = await requireClient();
      const result = await withConflictRetry(
        () =>
          moveTimelineClip(pb, clipId, {
            track: opts.track,
            at: opts.at,
            overwrite: opts.overwrite,
            ripple: opts.ripple,
            dryRun: opts.dryRun,
            timelineId: opts.timeline,
          }),
        {
          patchKeys: ['TimelineTrackRef', 'timelineStart'],
          force: opts.force,
        }
      );
      if (opts.json) {
        printRecord(result, [], true);
      } else {
        const where = `${range(result.placedAt, result.placedEnd)} on track ${result.track.layer} (${result.track.name})`;
        if (result.noop) {
          info(noopMessage(result.warnings) ?? 'Nothing to write.');
        } else if (result.dryRun) {
          info(`Dry run — nothing written. Clip would move to ${where}`);
        } else {
          success(`Moved clip ${result.clip!.id} to ${where}`);
        }
        reportPlacement(result);
      }
      printOpWarnings(result.warnings);
      enforceStrict(result.warnings, opts.strict);
    } catch (err) {
      handleError(err);
    }
  });

  withJsonOption(
    withStrictOption(
      workspaceOption(
        clips
          .command('ripple <clipId>')
          .description(
            'Shift a clip and everything after it on its track by ±seconds'
          )
          .requiredOption(
            '--by <seconds>',
            'seconds to shift, e.g. 2.5 or --by=-2.5 (negative pulls left)',
            parseSignedSeconds
          )
          .option('-t, --timeline <id>', 'timeline id (validated when passed)')
          .option('--dry-run', 'print the shifts without writing anything')
      )
    )
  ).action(async (clipId: string, opts) => {
    try {
      const pb = await requireClient();
      const result = await rippleTimelineClips(pb, clipId, {
        by: opts.by,
        dryRun: opts.dryRun,
        timelineId: opts.timeline,
      });
      if (opts.json) {
        printRecord(result, [], true);
      } else if (result.noop) {
        info(noopMessage(result.warnings) ?? 'Nothing to shift.');
      } else {
        const amount = `${result.by >= 0 ? '+' : ''}${result.by.toFixed(2)}s`;
        if (result.dryRun) {
          info(
            `Dry run — nothing written. Would shift ${result.shifted.length} clip(s) on track ${result.track.layer} by ${amount}`
          );
        } else {
          success(
            `Shifted ${result.shifted.length} clip(s) on track ${result.track.layer} by ${amount}`
          );
        }
        for (const shift of result.shifted) {
          info(`  ${shift.clipId}: ${secs(shift.from)} → ${secs(shift.to)}`);
        }
      }
      printOpWarnings(result.warnings);
      enforceStrict(result.warnings, opts.strict);
    } catch (err) {
      handleError(err);
    }
  });

  withJsonOption(
    withStrictOption(
      workspaceOption(
        clips
          .command('remove <clipId>')
          .description('Remove a clip from its timeline')
          .option('-t, --timeline <id>', 'timeline id (validated when passed)')
          .option(
            '--ripple',
            'shift later clips on the track left to close the gap'
          )
      )
    )
  ).action(async (clipId: string, opts) => {
    try {
      const pb = await requireClient();
      const result = await removeTimelineClip(pb, clipId, {
        ripple: opts.ripple,
        timelineId: opts.timeline,
      });
      if (opts.json) {
        printRecord(result, [], true);
      } else {
        success(
          `Removed clip ${result.clip.id} from timeline ${result.clip.TimelineRef}`
        );
        for (const shift of result.shifted) {
          info(
            `  rippled: ${shift.clipId} ${secs(shift.from)} → ${secs(shift.to)}`
          );
        }
      }
      printOpWarnings(result.warnings);
      enforceStrict(result.warnings, opts.strict);
    } catch (err) {
      handleError(err);
    }
  });

  withJsonOption(
    withStrictOption(
      workspaceOption(
        clips
          .command('reorder <clipIds...>')
          .description(
            'Replace the clip order: pass every clip id in the new sequence'
          )
          .requiredOption('-t, --timeline <id>', 'timeline id')
      )
    )
  ).action(async (clipIds: string[], opts) => {
    try {
      const pb = await requireClient();
      const result = await reorderTimelineClips(pb, opts.timeline, clipIds);
      if (opts.json) {
        printRecord(
          {
            items: result.clips,
            totalItems: result.clips.length,
            noop: result.noop,
            warnings: result.warnings,
          },
          [],
          true
        );
      } else if (result.noop) {
        info(noopMessage(result.warnings) ?? 'Nothing to write.');
      } else {
        success(
          `Reordered ${result.clips.length} clips on timeline ${opts.timeline}`
        );
      }
      printOpWarnings(result.warnings);
      enforceStrict(result.warnings, opts.strict);
    } catch (err) {
      handleError(err);
    }
  });

  registerTimelineClipSegmentCommands(clips);
}
