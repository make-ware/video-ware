import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import type { Command } from 'commander';
import { LABEL_TRACK_TYPE_VALUES } from '@project/shared';
import { handleError, requireClient } from '../lib/run.js';
import { resolveWorkspaceId } from '../lib/select.js';
import { resolveEntity } from '../lib/entity.js';
import {
  parseSeconds,
  parseUnitInterval,
  withJsonOption,
} from '../lib/options.js';
import { runList, withListOptions } from '../lib/list/index.js';
import {
  assertWritableOutPath,
  isExistingDirectory,
  resolveOutPath,
} from '../lib/out-path.js';
import {
  formatDuration,
  info,
  printRecord,
  success,
  table,
  truncate,
  warn,
} from '../lib/output.js';
import { TRACK_HELP } from '../lib/help.js';
import {
  DEFAULT_AT_LIMIT,
  DEFAULT_MAX_FRAMES,
  DEFAULT_PRECISION,
  DEFAULT_SHOW_FRAMES,
  TRACK_EXPORT_DEFAULTS,
  TRACK_EXPORT_FORMATS,
  andFilters,
  budgetExceededMessage,
  csvHeader,
  csvLine,
  estimateExportFrames,
  exportRow,
  fetchExportTracks,
  fetchKeyframes,
  fetchTrackPage,
  filterByRegion,
  frameSizes,
  getTrackDigest,
  getTracksAt,
  parseExportFormat,
  parseFps,
  parseNonNegativeInt,
  parsePositiveInt,
  parseTrackType,
  prepareFrames,
  trackListSpec,
  type TrackDigest,
  type TrackExportManifest,
  type TrackExportOptions,
  type TrackRecord,
  type TracksAtResult,
} from '../lib/track.js';
import { entityAttributionFilter, type Bbox } from '@project/shared';

/** Two-decimal seconds, the format every other `vw` time column uses. */
function at(seconds: number): string {
  return `${seconds.toFixed(2)}s`;
}

/** A normalized box as four 3-decimal fractions. */
function boxText(box: Bbox): string {
  return (
    `l ${box.left.toFixed(3)}  t ${box.top.toFixed(3)}  ` +
    `r ${box.right.toFixed(3)}  b ${box.bottom.toFixed(3)}`
  );
}

/** The concise lines `vw track show` prints above its sample table. */
function digestLines(digest: TrackDigest): string[] {
  const { track, frame } = digest;
  const subject = digest.subject ? ` "${digest.subject}"` : '';
  const lines = [
    `track ${track.id} — ${track.labelType || 'untyped'}${subject} ` +
      `(track ${track.trackId}) in media ${track.MediaRef} "${digest.mediaName}"`,
    `range   ${at(track.start)}–${at(track.end)} (${formatDuration(track.duration)})   ` +
      `confidence ${track.confidence.toFixed(2)}   frames ${digest.frameCount}` +
      (digest.frameRate ? ` (~${digest.frameRate.toFixed(1)}/s)` : ''),
  ];

  if (digest.union) {
    const pixels = digest.unionPixels
      ? `   →  ${digest.unionPixels.left},${digest.unionPixels.top} – ` +
        `${digest.unionPixels.right},${digest.unionPixels.bottom} px of ` +
        `${frame.width}x${frame.height}`
      : '';
    lines.push(`union   ${boxText(digest.union)}${pixels}`);
  } else {
    // Speech and speaker tracks store `keyframes: []` by design.
    lines.push('union   (no spatial keyframes — this track kind has none)');
  }

  if (digest.motion) {
    const { from, to, areaChange, description } = digest.motion;
    const area =
      Math.abs(areaChange) > 0.01
        ? `, size ${areaChange > 0 ? '+' : '−'}${Math.abs(areaChange * 100).toFixed(0)}%`
        : '';
    lines.push(
      `motion  centre ${(from.x * 100).toFixed(0)}%,${(from.y * 100).toFixed(0)}% → ` +
        `${(to.x * 100).toFixed(0)}%,${(to.y * 100).toFixed(0)}%   (${description}${area})`
    );
  }

  if (digest.entity) {
    lines.push(
      `entity  ${digest.entity.name} (${digest.entity.kind}, ${digest.entity.id})`
    );
  }
  return lines;
}

/** `vw track show`'s sampled-keyframe table plus its footer. */
function printSamples(digest: TrackDigest): void {
  if (digest.samples.length === 0) return;
  info('');
  table(digest.samples, [
    { header: 'T', value: (kf) => kf.t.toFixed(3) },
    { header: 'LEFT', value: (kf) => kf.bbox.left.toFixed(3) },
    { header: 'TOP', value: (kf) => kf.bbox.top.toFixed(3) },
    { header: 'RIGHT', value: (kf) => kf.bbox.right.toFixed(3) },
    { header: 'BOTTOM', value: (kf) => kf.bbox.bottom.toFixed(3) },
    {
      header: 'CONF',
      value: (kf) =>
        typeof kf.confidence === 'number' ? kf.confidence.toFixed(2) : '',
    },
  ]);
  if (digest.samples.length < digest.frameCount) {
    info(
      `(${digest.samples.length} of ${digest.frameCount} frames — ` +
        `--frames N for more, or \`vw track export --track ${digest.track.id}\` for all)`
    );
  }
  const first = digest.samples[0];
  info(
    `see it: vw frame -m ${digest.track.MediaRef} --at ${first.t.toFixed(2)} -o frame.jpg`
  );
}

/** `vw track at`'s table of live boxes. */
function printTracksAt(result: TracksAtResult): void {
  info(
    `${result.hits.length} track(s) on screen at ${at(result.at)} in ` +
      `${result.mediaName} (${result.frame.width}x${result.frame.height})`
  );
  table(result.hits, [
    { header: 'ID', value: (h) => h.track.id },
    { header: 'TYPE', value: (h) => h.track.labelType || '?' },
    { header: 'TRACK', value: (h) => h.track.trackId },
    { header: 'SUBJECT', value: (h) => truncate(h.subject, 24) },
    { header: 'ENTITY', value: (h) => h.entity?.name ?? '' },
    { header: 'LEFT', value: (h) => h.bbox.left.toFixed(3) },
    { header: 'TOP', value: (h) => h.bbox.top.toFixed(3) },
    { header: 'RIGHT', value: (h) => h.bbox.right.toFixed(3) },
    { header: 'BOTTOM', value: (h) => h.bbox.bottom.toFixed(3) },
    {
      header: 'PIXELS',
      value: (h) => (h.pixels ? `${h.pixels.width}x${h.pixels.height}` : ''),
    },
    { header: 'CONF', value: (h) => h.track.confidence.toFixed(2) },
  ]);

  if (result.withoutGeometry > 0) {
    info(
      `(${result.withoutGeometry} live track(s) hidden — speech/speaker tracks ` +
        'store no spatial keyframes)'
    );
  }
  if (result.totalLive > result.hits.length + result.withoutGeometry) {
    info(
      `(showing ${result.hits.length} of ${result.totalLive} live tracks — ` +
        'raise -n, or narrow with -t/--min-confidence)'
    );
  }
  info(`see it: vw frame -m ${result.mediaId} --at ${result.at} -o frame.jpg`);
}

/** Where the export's bytes land, and how they get there. */
interface ExportSink {
  write: (chunk: string) => Promise<void>;
  close: () => Promise<void>;
  /** Absolute path, or null when streaming to stdout. */
  path: string | null;
}

/**
 * Open the export's destination.
 *
 * A file by default — a terminal is not a data sink, and a keyframe dump is the
 * one `vw` output that can run to tens of megabytes. `--stdout` is the explicit
 * opt-in for piping, and it is the only way frames reach the terminal.
 */
function openSink(opts: {
  stdout?: boolean;
  out?: string;
  defaultName: string;
  force?: boolean;
}): ExportSink {
  if (opts.stdout) {
    return {
      write: async (chunk) => {
        if (!process.stdout.write(chunk)) await once(process.stdout, 'drain');
      },
      close: async () => undefined,
      path: null,
    };
  }

  const path = resolveOutPath(
    opts.out,
    opts.defaultName,
    process.cwd(),
    isExistingDirectory
  );
  assertWritableOutPath(path, opts.force);
  const stream = createWriteStream(path);
  return {
    write: async (chunk) => {
      if (!stream.write(chunk)) await once(stream, 'drain');
    },
    close: async () => {
      stream.end();
      await once(stream, 'close');
    },
    path,
  };
}

/**
 * Per-track progress on stderr, so `--json`, `--stdout`, and any redirect stay
 * clean, and only when stderr is a terminal. Throttled like `vw media download`
 * — a large export takes long enough that silence reads as a hang.
 */
function exportProgress(): (done: number, total: number) => void {
  if (!process.stderr.isTTY) return () => undefined;
  let lastAt = 0;
  return (done, total) => {
    const now = Date.now();
    if (done < total && now - lastAt < 250) return;
    lastAt = now;
    process.stderr.write(`\r  track ${done} / ${total}    `);
  };
}

/** Clear the progress line so the summary starts on a clean row. */
function clearProgress(): void {
  if (process.stderr.isTTY) process.stderr.write('\r\u001b[K');
}

export function registerTrackCommands(program: Command): void {
  const track = program
    .command('track')
    .description(
      'Read frame-level tracking data (bounding boxes over time) for ' +
        'objects, faces, people, and on-screen text'
    )
    .addHelpText('after', TRACK_HELP);

  // -------------------------------------------------------------------------
  // track list
  // -------------------------------------------------------------------------
  withListOptions(
    track
      .command('list')
      .alias('ls')
      .description(
        "List a media's (or an entity's) tracks — identity, span, and union " +
          'box, without reading a single keyframe'
      ),
    trackListSpec
  ).action(async (opts) => {
    try {
      const pb = await requireClient();
      const workspaceId = await resolveWorkspaceId(pb);
      const entityId = opts.entity
        ? (await resolveEntity(pb, workspaceId, opts.entity)).id
        : undefined;
      const region = opts.region as Bbox | undefined;

      await runList({
        spec: trackListSpec,
        opts,
        ctx: { pb, workspaceId },
        fetchPage: (query) => fetchTrackPage(pb, query, entityId),
        // `boundingBox` is a JSON column, so "overlaps this region" cannot be a
        // server clause. Declaring it here makes the runner walk every page so
        // the count in the footer describes what actually matched.
        refine: region && {
          filter: (tracks: TrackRecord[]) => filterByRegion(tracks, region),
          extras: (hidden) => ({ region, hiddenOutsideRegion: hidden }),
          note: (hidden) =>
            `(region filtered: ${hidden} track(s) whose union box misses the region hidden)`,
        },
      });
    } catch (err) {
      handleError(err);
    }
  });

  // -------------------------------------------------------------------------
  // track show
  // -------------------------------------------------------------------------
  const show = track
    .command('show <trackId>')
    .description(
      'Summarize one track: span, union box, drift, and an evenly spread ' +
        'sample of its keyframes'
    )
    .option(
      '--frames <n>',
      `keyframes to sample into the table (default: ${DEFAULT_SHOW_FRAMES})`,
      parsePositiveInt
    );
  withJsonOption(show).action(async (trackId: string, opts) => {
    try {
      const pb = await requireClient();
      const digest = await getTrackDigest(pb, trackId, { frames: opts.frames });

      if (opts.json) {
        printRecord(
          {
            ...digest.track,
            subject: digest.subject,
            mediaName: digest.mediaName,
            ...(digest.entity ? { attributedEntity: digest.entity } : {}),
            union: digest.union,
            unionPixels: digest.unionPixels,
            frame: digest.frame,
            frameCount: digest.frameCount,
            frameRate: digest.frameRate,
            motion: digest.motion,
            sampledKeyframes: digest.samples,
          },
          [],
          true
        );
        return;
      }

      for (const line of digestLines(digest)) info(line);
      printSamples(digest);
    } catch (err) {
      handleError(err);
    }
  });

  // -------------------------------------------------------------------------
  // track at
  // -------------------------------------------------------------------------
  const atCmd = track
    .command('at')
    .description(
      'What is on screen at one media time: every live track with its box ' +
        'interpolated between the surrounding keyframes'
    )
    .option('-m, --media <id>', 'the media to inspect')
    .option('--track <labelTrackId>', 'restrict to one track record')
    .option('--at <seconds>', 'media time to inspect', parseSeconds, 0)
    .option(
      '-t, --type <labelType>',
      `only this track kind (${LABEL_TRACK_TYPE_VALUES.join(', ')})`,
      parseTrackType
    )
    .option(
      '--min-confidence <n>',
      'minimum track confidence (0..1)',
      parseUnitInterval
    )
    .option(
      '-n, --limit <count>',
      `tracks to report (default: ${DEFAULT_AT_LIMIT})`,
      parsePositiveInt
    );
  withJsonOption(atCmd).action(async (opts) => {
    try {
      const pb = await requireClient();
      if (!opts.media && !opts.track) {
        throw new Error(
          'track at needs -m <mediaId> (every live track) or --track <labelTrackId> (one).'
        );
      }
      const result = await getTracksAt(pb, {
        mediaId: opts.media,
        trackRecordId: opts.track,
        at: opts.at,
        type: opts.type,
        minConfidence: opts.minConfidence,
        limit: opts.limit,
      });

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      printTracksAt(result);
    } catch (err) {
      handleError(err);
    }
  });

  // -------------------------------------------------------------------------
  // track export
  // -------------------------------------------------------------------------
  const exportCmd = track
    .command('export')
    .description(
      'Write every keyframe of the matching tracks to a file (CSV by default) ' +
        '— the bulk read, budgeted and never aimed at the terminal'
    )
    .option('-m, --media <id>', 'tracks belonging to one media')
    .option(
      '--entity <nameOrId>',
      'tracks attributed to this real-world entity'
    )
    .option('--track <labelTrackId>', 'one track record')
    .option(
      '-t, --type <labelType>',
      `only this track kind (${LABEL_TRACK_TYPE_VALUES.join(', ')})`,
      parseTrackType
    )
    .option(
      '--from <seconds>',
      'tracks overlapping at/after this time',
      parseSeconds
    )
    .option(
      '--to <seconds>',
      'tracks overlapping before this time',
      parseSeconds
    )
    .option(
      '--min-confidence <n>',
      'minimum track confidence (0..1)',
      parseUnitInterval
    )
    .option(
      '--min-duration <seconds>',
      'drop tracks shorter than this',
      parseSeconds
    )
    .option(
      '--format <format>',
      `output format (${TRACK_EXPORT_FORMATS.join(', ')}; default: csv)`,
      parseExportFormat
    )
    .option(
      '--every <seconds>',
      'keep at most one frame per interval (thins an 8fps track)',
      parseSeconds
    )
    .option(
      '--fps <n>',
      'keep at most this many frames per second (--every, expressed as a rate)',
      parseFps
    )
    .option(
      '--max-frames-per-track <n>',
      'cap frames per track, sampled evenly across its span',
      parsePositiveInt
    )
    .option(
      '--precision <digits>',
      `decimals for box/confidence values (default: ${DEFAULT_PRECISION})`,
      parseNonNegativeInt
    )
    .option(
      '--pixels',
      'emit whole pixels of the display frame, not 0-1 fractions'
    )
    .option('--relative', "emit t as an offset from each track's start")
    .option(
      '--max-frames <n>',
      `refuse an export estimated above this many frames (default: ${DEFAULT_MAX_FRAMES})`,
      parsePositiveInt
    )
    .option(
      '-o, --out <path>',
      'output file, or a directory to write the default name into ' +
        '(default: tracks-<scope>.<ext> in the current directory)'
    )
    .option('--stdout', 'stream to stdout instead of writing a file')
    .option('--force', 'overwrite the output file if it already exists');
  withJsonOption(exportCmd).action(async (opts) => {
    try {
      const pb = await requireClient();
      const workspaceId = await resolveWorkspaceId(pb);

      if (!opts.media && !opts.entity && !opts.track) {
        throw new Error(
          'track export needs a scope: -m <mediaId>, --entity <nameOrId>, or ' +
            '--track <labelTrackId>. A whole workspace is never dumped by accident.'
        );
      }
      if (opts.every !== undefined && opts.fps !== undefined) {
        throw new Error(
          'Pass --every or --fps, not both — they set the same thing.'
        );
      }

      const exportOptions: TrackExportOptions = {
        ...TRACK_EXPORT_DEFAULTS,
        format: opts.format ?? TRACK_EXPORT_DEFAULTS.format,
        every: opts.fps !== undefined ? 1 / opts.fps : (opts.every ?? 0),
        maxFramesPerTrack: opts.maxFramesPerTrack,
        precision: opts.precision ?? DEFAULT_PRECISION,
        pixels: Boolean(opts.pixels),
        relative: Boolean(opts.relative),
        maxFrames: opts.maxFrames ?? DEFAULT_MAX_FRAMES,
      };

      // --- Phase 1: the cheap read. Summary rows only, no keyframes. ---
      const clauses = [pb.filter('WorkspaceRef = {:ws}', { ws: workspaceId })];
      if (opts.media)
        clauses.push(pb.filter('MediaRef = {:m}', { m: opts.media }));
      if (opts.track) clauses.push(pb.filter('id = {:id}', { id: opts.track }));
      if (opts.type)
        clauses.push(pb.filter('labelType = {:lt}', { lt: opts.type }));
      if (opts.from !== undefined) {
        clauses.push(pb.filter('end > {:wStart}', { wStart: opts.from }));
      }
      if (opts.to !== undefined) {
        clauses.push(pb.filter('start < {:wEnd}', { wEnd: opts.to }));
      }
      if (opts.minConfidence !== undefined) {
        clauses.push(
          pb.filter('confidence >= {:mc}', { mc: opts.minConfidence })
        );
      }
      if (opts.minDuration !== undefined) {
        clauses.push(pb.filter('duration >= {:md}', { md: opts.minDuration }));
      }
      const entityId = opts.entity
        ? (await resolveEntity(pb, workspaceId, opts.entity)).id
        : undefined;
      const filter = andFilters(
        entityId ? entityAttributionFilter(entityId) : '',
        clauses.join(' && ')
      );

      const tracks = await fetchExportTracks(pb, filter);
      if (tracks.length === 0) {
        throw new Error(
          'No tracks match that scope. `vw track list` with the same flags ' +
            'shows what is there.'
        );
      }

      // --- The budget check, before a single keyframe request. ---
      const estimated = estimateExportFrames(tracks, exportOptions);
      if (estimated > exportOptions.maxFrames) {
        throw new Error(budgetExceededMessage(estimated, exportOptions));
      }

      const scope = opts.media ?? opts.track ?? entityId ?? 'workspace';
      const extension =
        exportOptions.format === 'json' ? 'json' : exportOptions.format;
      const sink = openSink({
        stdout: opts.stdout,
        out: opts.out,
        defaultName: `tracks-${scope}.${extension}`,
        force: opts.force,
      });

      const sizes = exportOptions.pixels
        ? await frameSizes(pb, tracks)
        : new Map<string, { width: number; height: number }>();
      const report = exportProgress();

      // --- Phase 2: the heavy read, one track at a time. ---
      let frameCount = 0;
      let tracksWithoutGeometry = 0;
      let jsonFirst = true;
      try {
        if (exportOptions.format === 'csv') {
          await sink.write(`${csvHeader(exportOptions)}\n`);
        } else if (exportOptions.format === 'json') {
          await sink.write('{"tracks":[');
        }

        for (const [index, trackRow] of tracks.entries()) {
          report(index + 1, tracks.length);
          const keyframes = await fetchKeyframes(pb, trackRow.id);
          if (keyframes.length === 0) {
            tracksWithoutGeometry++;
            continue;
          }
          const frames = prepareFrames(keyframes, trackRow, exportOptions);
          const size = sizes.get(trackRow.MediaRef) ?? { width: 0, height: 0 };

          if (exportOptions.format === 'json') {
            const rows = frames
              .map((kf) => exportRow(trackRow, kf, exportOptions, size))
              .filter((row) => row !== null);
            if (rows.length === 0) continue;
            frameCount += rows.length;
            await sink.write(
              `${jsonFirst ? '' : ','}${JSON.stringify({
                id: trackRow.id,
                trackId: trackRow.trackId,
                MediaRef: trackRow.MediaRef,
                labelType: trackRow.labelType,
                start: trackRow.start,
                end: trackRow.end,
                confidence: trackRow.confidence,
                keyframes: rows,
              })}`
            );
            jsonFirst = false;
            continue;
          }

          let chunk = '';
          for (const kf of frames) {
            const row = exportRow(trackRow, kf, exportOptions, size);
            if (!row) continue;
            frameCount++;
            chunk +=
              exportOptions.format === 'csv'
                ? `${csvLine(row)}\n`
                : `${JSON.stringify(row)}\n`;
          }
          if (chunk) await sink.write(chunk);
        }

        if (exportOptions.format === 'json') await sink.write(']}\n');
      } finally {
        await sink.close();
        clearProgress();
      }

      const manifest: TrackExportManifest = {
        format: exportOptions.format,
        units: exportOptions.pixels ? 'pixels' : 'normalized',
        timebase: exportOptions.relative ? 'track' : 'media',
        precision: exportOptions.precision,
        every: exportOptions.every,
        maxFramesPerTrack: exportOptions.maxFramesPerTrack,
        trackCount: tracks.length,
        frameCount,
        tracksWithoutGeometry,
        storedFrameCount: estimateExportFrames(tracks, { every: 0 }),
      };

      if (opts.json) {
        // stdout is the payload when streaming, so the manifest goes to stderr.
        const document = JSON.stringify(
          { ...manifest, ...(sink.path ? { path: sink.path } : {}) },
          null,
          2
        );
        if (sink.path) console.log(document);
        else process.stderr.write(`${document}\n`);
        return;
      }
      if (!sink.path) return; // stdout carried the frames; keep it clean.

      success(
        `Wrote ${frameCount.toLocaleString()} keyframe(s) from ` +
          `${tracks.length} track(s) to ${sink.path}`
      );
      const units = exportOptions.pixels
        ? `pixels of the display frame`
        : '0-1 fractions of the frame';
      info(
        `  ${exportOptions.format}, ${units}, t in ` +
          `${exportOptions.relative ? 'seconds from each track start' : 'absolute media seconds'}`
      );
      if (exportOptions.every > 0) {
        info(
          `  thinned to one frame per ${exportOptions.every.toFixed(3)}s ` +
            `(${manifest.storedFrameCount.toLocaleString()} stored)`
        );
      }
      if (tracksWithoutGeometry > 0) {
        warn(
          `${tracksWithoutGeometry} track(s) had no spatial keyframes and were ` +
            'skipped (speech/speaker tracks store none)'
        );
      }
    } catch (err) {
      handleError(err);
    }
  });
}
