import type { Command } from 'commander';
import type { ListResult } from 'pocketbase';
import {
  TimelineClipMutator,
  clipPlaybackRegions,
  regionSourceEnd,
  roundToMs,
  type TypedPocketBase,
} from '@project/shared';
import { handleError, requireClient } from '../lib/run.js';
import { pickTimeline, resolveWorkspaceId } from '../lib/select.js';
import { assertWorkspaceMatch } from '../lib/workspace-option.js';
import { resolveTrackRef } from '../lib/timeline.js';
import {
  listFilter,
  runList,
  windowItems,
  withListOptions,
  type ListSpec,
} from '../lib/list/index.js';
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
  mapClipTime,
  type InspectClipInfo,
  type MapDomain,
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
  printRecord,
  range,
  secs,
  success,
  truncate,
  warn,
} from '../lib/output.js';
import { compositeMarker, timelineClipTimes } from '../lib/clip-times.js';
import { withConflictRetry } from '../lib/conflict.js';
import { editResultHelp } from '../lib/help.js';
import {
  enforceStrict,
  noopMessage,
  printOpWarnings,
} from '../lib/warnings.js';
import { registerTimelineClipSegmentCommands } from './clip-segments.js';
import { registerTimelineClipTranscriptCommand } from './clip-transcript.js';
import { printLabelDetail, reportPlacement } from './timeline.js';

/**
 * A timeline's clips as display rows, optionally windowed.
 *
 * The whole timeline is always read: a clip's computed timeline position
 * depends on the clips before it on its track, so there is no correct
 * single-page query. `perPage`/`page` therefore slice the computed rows, and
 * `totalItems` stays the true clip count so the footer never understates it.
 */
async function fetchTimelineClipRows(
  pb: TypedPocketBase,
  opts: {
    timelineId: string;
    track?: string;
    page: number;
    perPage: number;
    all: boolean;
  }
): Promise<ListResult<ClipRow>> {
  const overview = await getTimelineOverview(pb, opts.timelineId);
  // A `-w` naming another workspace is a mistake, not a redundancy — and this
  // catches it wherever it appeared on the command line, which reading
  // `opts.workspace` off the leaf command would not.
  await assertWorkspaceMatch(
    pb,
    overview.timeline.WorkspaceRef,
    `Timeline ${opts.timelineId}`
  );

  let tracks = overview.tracks;
  if (opts.track) {
    const target = await resolveTrackRef(pb, opts.timelineId, opts.track);
    tracks = tracks.filter((t) => t.track?.id === target.id);
  }

  const rows: ClipRow[] = tracks.flatMap((t) =>
    t.clips.map((c) => ({ ...c, layer: t.layer }))
  );

  return windowItems(rows, opts);
}

type ClipRow = InspectClipInfo & { layer: number };

/**
 * `timeline clips list`. A structure list: positions are computed from the
 * whole timeline (a clip's timeline start depends on every clip before it), so
 * the timeline is always fetched entire and `unpaged` makes the default output
 * the complete set. `--limit`/`--page` then window that computed view rather
 * than the query — see `fetchTimelineClipRows`.
 */
const timelineClipListSpec: ListSpec<ClipRow> = {
  command: 'timeline clips list',
  workspaceScoped: false,
  unpaged: true,
  required: ['timeline'],
  filters: {
    timeline: listFilter({
      flags: '-t, --timeline <id>',
      description: 'the timeline whose clips to list',
      clause: () => null,
      // Resolved lazily: the picker only runs when -t is missing on a TTY, so
      // a scripted `-t <id>` call never needs an active workspace at all.
      pick: async ({ pb }) =>
        (await pickTimeline(pb, await resolveWorkspaceId(pb))).id,
    }),
    track: listFilter({
      flags: '--track <layer|id>',
      description: 'restrict to one track (layer number or record id)',
      clause: () => null,
    }),
  },
  columns: [
    { header: 'ID', value: (r) => r.clip.id },
    { header: 'TRACK', value: (r) => String(r.layer) },
    { header: 'ORDER', value: (r) => String(r.clip.order) },
    {
      header: 'TIMELINE',
      value: (r) => range(r.timelineStart, r.timelineEnd),
    },
    {
      // Outer source span; ` ◆N` marks a composite (DUR is effective).
      header: 'SOURCE',
      value: (r) => range(r.clip.start, r.clip.end) + compositeMarker(r.times),
    },
    {
      header: 'DUR',
      value: (r) => secs(r.timelineEnd - r.timelineStart),
    },
    { header: 'KIND', value: (r) => r.kind },
    { header: 'LABEL', value: (r) => truncate(r.labelHint, 40) },
  ],
  hint: '`vw timeline clips show <id>` for one clip',
};

export function registerTimelineClipCommands(timeline: Command): void {
  const clips = timeline
    .command('clips')
    .description('List and edit the clips placed on a timeline');

  withListOptions(
    clips
      .command('list')
      .alias('ls')
      .description("List a timeline's clips with computed positions"),
    timelineClipListSpec
  ).action(async (opts) => {
    try {
      const pb = await requireClient();
      await runList({
        spec: timelineClipListSpec,
        opts,
        // `-w` is validated against the timeline's own workspace (in
        // fetchTimelineClipRows), not used as a filter, so it stays out of ctx.
        ctx: { pb },
        // `query.values`, not `opts`: a timeline resolved through the
        // interactive picker exists only on the resolved query.
        fetchPage: (query) =>
          fetchTimelineClipRows(pb, {
            timelineId: query.values.timeline as string,
            track: query.values.track as string | undefined,
            page: query.page,
            perPage: query.perPage,
            all: query.all,
          }),
      });
    } catch (err) {
      handleError(err);
    }
  });

  withJsonOption(
    clips
      .command('show <clipId>')
      .description('Show a timeline clip with its computed placement')
      .option('-t, --timeline <id>', 'timeline id (validated when passed)')
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

      const labels = opts.labels
        ? await clipLabelDetail(
            pb,
            clip,
            placement
              ? { placement: { timelineStart: placement.timelineStart } }
              : {}
          )
        : undefined;
      const times = placement?.times ?? timelineClipTimes(clip);
      // Continuous playback runs — the batch source↔timeline translation
      // table (touching segments coalesce, so runs can be < segment count).
      const regions =
        placement && clip.MediaRef
          ? clipPlaybackRegions({
              clip,
              globalStart: placement.timelineStart,
              globalEnd: placement.timelineEnd,
            }).map((region, index) => ({
              index,
              timelineStart: roundToMs(region.timelineStart),
              timelineEnd: roundToMs(region.timelineEnd),
              sourceStart: roundToMs(region.sourceStart),
              sourceEnd: roundToMs(regionSourceEnd(region)),
            }))
          : undefined;

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
            times,
            ...(regions ? { regions } : {}),
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
      if (times.composite && times.segments) {
        info(
          `  composite: ${times.segments.count} segments (source: ${times.segments.source}) — ` +
            `effective ${secs(times.effective.duration)} of ${secs(times.source.span)} span; ` +
            `\`vw timeline clips segments ${clip.id}\``
        );
      } else if (times.segments?.source === 'meta') {
        info(
          "  edit-list mask: 1 segment (masks the source MediaClip's edit list)"
        );
      }
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
      clips
        .command('update <clipId>')
        .description('Update a timeline clip (label, description, trim, gain)')
        .option('-t, --timeline <id>', 'timeline id (validated when passed)')
        .addHelpText('after', editResultHelp({ noop: true, conflict: true }))
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
        clips
          .command('move <clipId>')
          .description('Move a clip to another track and/or timeline position')
          .option('-t, --timeline <id>', 'timeline id (validated when passed)')
          .option('--track <layer|id>', 'destination track (default: current)')
          .option(
            '--at <seconds>',
            'new timeline position; nudges past collisions unless --ripple/--overwrite (default: keep current position)',
            parseSeconds
          )
          .option(
            '--overwrite',
            'with --at: trim/remove overlapping clips instead of nudging forward (mutually exclusive with --ripple)'
          )
          .option(
            '--ripple',
            'land at the exact time and shift later clips right to make room (mutually exclusive with --overwrite)'
          )
          .option(
            '--dry-run',
            'print the placement plan without writing anything'
          )
          .addHelpText('after', editResultHelp({ noop: true, conflict: true }))
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
    withForceOption(
      withStrictOption(
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
          .addHelpText('after', editResultHelp({ noop: true, conflict: true }))
      )
    )
  ).action(async (clipId: string, opts) => {
    try {
      const pb = await requireClient();
      const result = await withConflictRetry(
        () =>
          rippleTimelineClips(pb, clipId, {
            by: opts.by,
            dryRun: opts.dryRun,
            timelineId: opts.timeline,
          }),
        { patchKeys: ['timelineStart'], force: opts.force }
      );
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
      clips
        .command('remove <clipId>')
        .description('Remove a clip from its timeline')
        .option('-t, --timeline <id>', 'timeline id (validated when passed)')
        .option(
          '--ripple',
          'shift later clips on the track left to close the gap'
        )
        .option(
          '--force',
          'with --ripple: re-apply the gap-closing shifts over a concurrent edit instead of aborting'
        )
        .addHelpText('after', editResultHelp({ conflict: true }))
    )
  ).action(async (clipId: string, opts) => {
    try {
      const pb = await requireClient();
      const result = await withConflictRetry(
        () =>
          removeTimelineClip(pb, clipId, {
            ripple: opts.ripple,
            timelineId: opts.timeline,
          }),
        { patchKeys: ['timelineStart'], force: opts.force }
      );
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
      clips
        .command('reorder <clipIds...>')
        .description(
          'Replace the clip order: pass every clip id in the new sequence'
        )
        .requiredOption('-t, --timeline <id>', 'timeline id')
        .addHelpText('after', editResultHelp({ noop: true }))
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

  withJsonOption(
    clips
      .command('map <clipId>')
      .description(
        'Translate a time through a clip: source-media time ↔ ' +
          'clip-effective offset ↔ timeline time (edit-list aware)'
      )
      .option('-t, --timeline <id>', 'timeline id (validated when passed)')
      .option(
        '--source-time <seconds>',
        'locate a source-media time (gap times report the cut and collapse to its boundary)',
        parseSeconds
      )
      .option(
        '--timeline-time <seconds>',
        'locate an absolute timeline time',
        parseSeconds
      )
      .option(
        '--offset <seconds>',
        'locate a clip-effective offset (0 = first visible frame)',
        parseSeconds
      )
  ).action(async (clipId: string, opts) => {
    try {
      const pb = await requireClient();
      const candidates: Array<{ domain: MapDomain; value?: number }> = [
        { domain: 'source', value: opts.sourceTime },
        { domain: 'timeline', value: opts.timelineTime },
        { domain: 'offset', value: opts.offset },
      ];
      const inputs = candidates.filter((i) => i.value !== undefined);
      if (inputs.length !== 1) {
        throw new Error(
          'Pass exactly one of --source-time, --timeline-time, or --offset.'
        );
      }
      const { domain, value } = inputs[0] as {
        domain: MapDomain;
        value: number;
      };
      const result = await mapClipTime(pb, clipId, {
        domain,
        value,
        timelineId: opts.timeline,
      });
      if (opts.json) {
        printRecord(result, [], true);
        return;
      }
      const placed = result.times.timeline;
      info(
        `Clip ${result.clipId} on timeline ${result.timelineId} ` +
          `(track layer ${result.layer}${placed ? `, ${range(placed.start, placed.end)}` : ''})`
      );
      if (result.inGap && result.gap) {
        info(
          `  source ${secs(value)} falls in a cut gap ` +
            `(${range(result.gap.start, result.gap.end)}) — this moment is not played`
        );
        info(
          `  collapses to: source ${secs(result.point.source)}  =  ` +
            `offset ${secs(result.point.offset)}  =  timeline ${secs(result.point.timeline)}`
        );
      } else {
        info(
          `  source ${secs(result.point.source)}  =  ` +
            `offset ${secs(result.point.offset)}  =  timeline ${secs(result.point.timeline)}`
        );
      }
      if (result.point.segment) {
        info(
          `  segment ${result.point.segment.index} ` +
            `(${range(result.point.segment.start, result.point.segment.end)})`
        );
      }
      if (result.clamped) {
        warn(
          `input ${secs(value)} is outside the clip's played content — ` +
            'clamped to the nearest edge'
        );
      }
    } catch (err) {
      handleError(err);
    }
  });

  registerTimelineClipSegmentCommands(clips);
  registerTimelineClipTranscriptCommand(clips);
}
