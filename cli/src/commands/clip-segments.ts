import type { Command } from 'commander';
import type { CompositeSegment } from '@project/shared';
import { handleError, requireClient } from '../lib/run.js';
import {
  editMediaClipSegments,
  editTimelineClipSegments,
  inspectMediaClipSegments,
  inspectTimelineClipSegments,
  type MediaClipSegmentsEditResult,
  type SegmentOp,
  type SegmentsInspection,
  type TimelineClipSegmentsEditResult,
} from '../lib/clip-segments.js';
import {
  parseIndex,
  parseSeconds,
  parseSecondsList,
  parseSignedSeconds,
  withJsonOption,
} from '../lib/options.js';
import { info, printRecord, success, table } from '../lib/output.js';

/**
 * Segment-level edit subcommands (split/cut/trim/slip/segments), registered
 * identically under `vw media clip …` and `vw timeline clips …`. All time
 * values are source-media seconds — the same time base as stored segments
 * and transcript word times, so an AI editor can cut an umm straight from a
 * transcript. Timeline variants additionally accept -t/--ripple.
 */

const secs = (v: number) => `${v.toFixed(2)}s`;
const range = (start: number, end: number) =>
  `${start.toFixed(2)}–${end.toFixed(2)}s`;
const signed = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}s`;

/** `-w` is accepted on every clip command so agents can pass it uniformly. */
const workspaceOption = (cmd: Command): Command =>
  cmd.option(
    '-w, --workspace <id>',
    'workspace id (accepted for flag consistency; clips are addressed by id)'
  );

const effectiveOf = (segments: CompositeSegment[]): number =>
  segments.reduce((total, s) => total + Math.max(0, s.end - s.start), 0);

/** One-line human description of an op, e.g. "Cut 10.00–12.00s from". */
function describeOp(op: SegmentOp): string {
  switch (op.kind) {
    case 'split':
      return `Split at ${op.at.map(secs).join(', ')}:`;
    case 'cut':
      return `Cut ${range(op.from, op.to)} from`;
    case 'trim':
      return `Trimmed segment ${op.segment ?? 0} of`;
    case 'slip':
      return `Slipped${op.segment !== undefined ? ` segment ${op.segment} of` : ''}`;
  }
}

/** Shared human/JSON reporting for both domains' edit results. */
function reportEdit(
  clipId: string,
  op: SegmentOp,
  result: MediaClipSegmentsEditResult | TimelineClipSegmentsEditResult,
  json?: boolean
): void {
  if (json) {
    printRecord(result, [], true);
    return;
  }

  if (op.kind === 'slip' && result.appliedBy === 0) {
    info(
      'Nothing to slip — the segment is already flush against its bounds ' +
        `(requested ${signed(result.requestedBy ?? 0)}).`
    );
    return;
  }

  const summary =
    `${describeOp(op)} clip ${clipId}` +
    (op.kind === 'slip' ? ` by ${signed(result.appliedBy ?? 0)}` : '') +
    ` — effective ${secs(effectiveOf(result.before))} → ` +
    `${secs(result.times.duration)} (${result.after.length} segment${result.after.length === 1 ? '' : 's'})`;

  if (result.dryRun) {
    info(`Dry run — nothing written. Would have: ${summary}`);
  } else {
    success(summary);
  }

  if (
    op.kind === 'slip' &&
    result.requestedBy !== undefined &&
    result.appliedBy !== result.requestedBy
  ) {
    info(
      `  requested ${signed(result.requestedBy)} — clamped by media bounds/neighbors`
    );
  }
  if ('converted' in result && result.converted) {
    info('  converted to a composite clip (edit list created)');
  }
  if ('segmentsSource' in result && result.segmentsSource !== 'meta') {
    const from =
      result.segmentsSource === 'mediaClip'
        ? "the source MediaClip's edit list"
        : "the clip's trim window";
    info(
      `  edit list initialized from ${from} — this clip now keeps its own copy`
    );
  }
  if ('rippled' in result) {
    for (const shift of result.rippled) {
      info(
        `  rippled: ${shift.clipId} ${secs(shift.from)} → ${secs(shift.to)}`
      );
    }
  }
}

/** Human/JSON reporting for the read-only `segments` subcommand. */
function reportInspection(
  clipId: string,
  inspection: SegmentsInspection,
  json?: boolean
): void {
  if (json) {
    printRecord(inspection, [], true);
    return;
  }
  const sourceHint =
    inspection.source === 'trim'
      ? 'trim window — not composite yet; the first edit converts it'
      : inspection.source;
  info(
    `Clip ${clipId} — ${inspection.segments.length} segment(s), ` +
      `effective ${secs(inspection.times.duration)}, ` +
      `span ${range(inspection.times.start, inspection.times.end)}`
  );
  info(
    `  media ${inspection.mediaId} (${secs(inspection.mediaDuration)}) — edit list source: ${sourceHint}`
  );
  const gapAfter = new Map(
    inspection.gaps.map((g) => [g.afterIndex, g.seconds])
  );
  table(
    inspection.segments.map((seg, index) => ({ seg, index })),
    [
      { header: 'IDX', value: (r) => String(r.index) },
      { header: 'START', value: (r) => secs(r.seg.start) },
      { header: 'END', value: (r) => secs(r.seg.end) },
      { header: 'DUR', value: (r) => secs(r.seg.end - r.seg.start) },
      {
        header: 'GAP-AFTER',
        value: (r) => {
          const gap = gapAfter.get(r.index);
          return gap !== undefined ? secs(gap) : '';
        },
      },
    ]
  );
}

/** The flags shared by both domains for one op subcommand. */
function segmentEditCommand(
  parent: Command,
  name: string,
  description: string
): Command {
  return withJsonOption(
    workspaceOption(
      parent
        .command(`${name} <clipId>`)
        .description(description)
        .option('--dry-run', 'print the resulting edit list without writing')
    )
  );
}

interface TimelineEditFlags {
  timeline?: string;
  ripple?: boolean;
  dryRun?: boolean;
  json?: boolean;
}

/** Register split/cut/trim/slip/segments under `vw media clip`. */
export function registerMediaClipSegmentCommands(clip: Command): void {
  segmentEditCommand(
    clip,
    'split',
    'Split the edit list at source-media time(s), creating trim boundaries'
  )
    .requiredOption(
      '--at <seconds>',
      'source-media split point(s), comma-separated (e.g. 12.4 or 5,12.4)',
      parseSecondsList
    )
    .action(async (clipId: string, opts) => {
      try {
        const pb = await requireClient();
        const op: SegmentOp = { kind: 'split', at: opts.at };
        reportEdit(
          clipId,
          op,
          await editMediaClipSegments(pb, clipId, op, { dryRun: opts.dryRun }),
          opts.json
        );
      } catch (err) {
        handleError(err);
      }
    });

  segmentEditCommand(
    clip,
    'cut',
    'Remove a source-media time range from the edit list (e.g. an umm)'
  )
    .requiredOption(
      '--from <seconds>',
      'start of the range to remove (source-media seconds)',
      parseSeconds
    )
    .requiredOption(
      '--to <seconds>',
      'end of the range to remove (source-media seconds)',
      parseSeconds
    )
    .action(async (clipId: string, opts) => {
      try {
        const pb = await requireClient();
        const op: SegmentOp = { kind: 'cut', from: opts.from, to: opts.to };
        reportEdit(
          clipId,
          op,
          await editMediaClipSegments(pb, clipId, op, { dryRun: opts.dryRun }),
          opts.json
        );
      } catch (err) {
        handleError(err);
      }
    });

  segmentEditCommand(
    clip,
    'trim',
    'Re-edge one segment of the edit list (may extend into cut gaps)'
  )
    .option(
      '--segment <n>',
      'segment index (see `segments`; optional for single-segment clips)',
      parseIndex
    )
    .option(
      '-s, --start <seconds>',
      'new segment start (source-media seconds)',
      parseSeconds
    )
    .option(
      '-e, --end <seconds>',
      'new segment end (source-media seconds)',
      parseSeconds
    )
    .action(async (clipId: string, opts) => {
      try {
        const pb = await requireClient();
        const op: SegmentOp = {
          kind: 'trim',
          segment: opts.segment,
          start: opts.start,
          end: opts.end,
        };
        reportEdit(
          clipId,
          op,
          await editMediaClipSegments(pb, clipId, op, { dryRun: opts.dryRun }),
          opts.json
        );
      } catch (err) {
        handleError(err);
      }
    });

  segmentEditCommand(
    clip,
    'slip',
    'Slip the source content ±seconds (same length, different content)'
  )
    .alias('shift')
    .requiredOption(
      '--by <seconds>',
      'seconds to slip, e.g. 0.5 or --by=-0.5 (negative pulls earlier content)',
      parseSignedSeconds
    )
    .option(
      '--segment <n>',
      'slip only this segment (default: the whole edit list)',
      parseIndex
    )
    .action(async (clipId: string, opts) => {
      try {
        const pb = await requireClient();
        const op: SegmentOp = {
          kind: 'slip',
          by: opts.by,
          segment: opts.segment,
        };
        reportEdit(
          clipId,
          op,
          await editMediaClipSegments(pb, clipId, op, { dryRun: opts.dryRun }),
          opts.json
        );
      } catch (err) {
        handleError(err);
      }
    });

  withJsonOption(
    workspaceOption(
      clip
        .command('segments <clipId>')
        .description("Show a media clip's edit list (segments and gaps)")
    )
  ).action(async (clipId: string, opts) => {
    try {
      const pb = await requireClient();
      reportInspection(
        clipId,
        await inspectMediaClipSegments(pb, clipId),
        opts.json
      );
    } catch (err) {
      handleError(err);
    }
  });
}

/** Register split/cut/trim/slip/segments under `vw timeline clips`. */
export function registerTimelineClipSegmentCommands(clips: Command): void {
  const timelineOption = (cmd: Command): Command =>
    cmd.option('-t, --timeline <id>', 'timeline id (validated when passed)');

  const runEdit = async (
    clipId: string,
    op: SegmentOp,
    opts: TimelineEditFlags
  ): Promise<void> => {
    const pb = await requireClient();
    reportEdit(
      clipId,
      op,
      await editTimelineClipSegments(pb, clipId, op, {
        ripple: opts.ripple,
        dryRun: opts.dryRun,
        timelineId: opts.timeline,
      }),
      opts.json
    );
  };

  timelineOption(
    segmentEditCommand(
      clips,
      'split',
      'Split the edit list at source-media time(s), creating trim boundaries'
    ).requiredOption(
      '--at <seconds>',
      'source-media split point(s), comma-separated (e.g. 12.4 or 5,12.4)',
      parseSecondsList
    )
  ).action(async (clipId: string, opts) => {
    try {
      await runEdit(clipId, { kind: 'split', at: opts.at }, opts);
    } catch (err) {
      handleError(err);
    }
  });

  timelineOption(
    segmentEditCommand(
      clips,
      'cut',
      'Remove a source-media time range from the edit list (e.g. an umm)'
    )
      .requiredOption(
        '--from <seconds>',
        'start of the range to remove (source-media seconds)',
        parseSeconds
      )
      .requiredOption(
        '--to <seconds>',
        'end of the range to remove (source-media seconds)',
        parseSeconds
      )
      .option(
        '--ripple',
        'shift later clips on the track left to close the gap'
      )
  ).action(async (clipId: string, opts) => {
    try {
      await runEdit(
        clipId,
        { kind: 'cut', from: opts.from, to: opts.to },
        opts
      );
    } catch (err) {
      handleError(err);
    }
  });

  timelineOption(
    segmentEditCommand(
      clips,
      'trim',
      'Re-edge one segment of the edit list (may extend into cut gaps)'
    )
      .option(
        '--segment <n>',
        'segment index (see `segments`; optional for single-segment clips)',
        parseIndex
      )
      .option(
        '-s, --start <seconds>',
        'new segment start (source-media seconds)',
        parseSeconds
      )
      .option(
        '-e, --end <seconds>',
        'new segment end (source-media seconds)',
        parseSeconds
      )
      .option(
        '--ripple',
        'shift later clips on the track by the duration change'
      )
  ).action(async (clipId: string, opts) => {
    try {
      await runEdit(
        clipId,
        {
          kind: 'trim',
          segment: opts.segment,
          start: opts.start,
          end: opts.end,
        },
        opts
      );
    } catch (err) {
      handleError(err);
    }
  });

  timelineOption(
    segmentEditCommand(
      clips,
      'slip',
      'Slip the source content ±seconds (same length, different content)'
    )
      .alias('shift')
      .requiredOption(
        '--by <seconds>',
        'seconds to slip, e.g. 0.5 or --by=-0.5 (negative pulls earlier content)',
        parseSignedSeconds
      )
      .option(
        '--segment <n>',
        'slip only this segment (default: the whole edit list)',
        parseIndex
      )
  ).action(async (clipId: string, opts) => {
    try {
      await runEdit(
        clipId,
        { kind: 'slip', by: opts.by, segment: opts.segment },
        opts
      );
    } catch (err) {
      handleError(err);
    }
  });

  withJsonOption(
    workspaceOption(
      timelineOption(
        clips
          .command('segments <clipId>')
          .description(
            "Show a timeline clip's edit list (segments, gaps, source)"
          )
      )
    )
  ).action(async (clipId: string, opts) => {
    try {
      const pb = await requireClient();
      reportInspection(
        clipId,
        await inspectTimelineClipSegments(pb, clipId, opts.timeline),
        opts.json
      );
    } catch (err) {
      handleError(err);
    }
  });
}
