import type { Command } from 'commander';
import { handleError, requireClient } from '../lib/run.js';
import {
  createTrack,
  deleteTrack,
  listTracks,
  parseLayer,
  trackFieldOptions,
  updateTrack,
  type TrackWithClipCount,
} from '../lib/timeline-track.js';
import { applyOptions, pickOptions, withJsonOption } from '../lib/options.js';
import {
  info,
  printList,
  printRecord,
  success,
  truncate,
} from '../lib/output.js';

function trackFlags(row: TrackWithClipCount): string {
  const flags = [
    row.track.isMuted ? 'muted' : '',
    row.track.isLocked ? 'locked' : '',
  ].filter(Boolean);
  return flags.join(',');
}

export function registerTimelineTrackCommands(timeline: Command): void {
  const track = timeline
    .command('track')
    .description('Manage timeline tracks (layers with volume/opacity)');

  const create = track
    .command('create')
    .description('Create a track on the next layer up')
    .requiredOption('-t, --timeline <id>', 'timeline id')
    .option('--muted', 'create the track muted')
    .option('--locked', 'create the track locked');
  applyOptions(withJsonOption(create), trackFieldOptions).action(
    async (opts) => {
      try {
        const pb = await requireClient();
        const created = await createTrack(pb, {
          timelineId: opts.timeline,
          muted: opts.muted,
          locked: opts.locked,
          ...pickOptions(opts, trackFieldOptions),
        });
        if (opts.json) {
          printRecord(created, [], true);
          return;
        }
        success(
          `Created track ${created.id} "${created.name}" on layer ${created.layer}`
        );
      } catch (err) {
        handleError(err);
      }
    }
  );

  withJsonOption(
    track
      .command('list')
      .alias('ls')
      .description("List a timeline's tracks (layer ascending)")
      .requiredOption('-t, --timeline <id>', 'timeline id')
  ).action(async (opts) => {
    try {
      const pb = await requireClient();
      const result = await listTracks(pb, opts.timeline);
      printList(
        result.items,
        [
          { header: 'ID', value: (r) => r.track.id },
          { header: 'LAYER', value: (r) => String(r.track.layer) },
          { header: 'NAME', value: (r) => r.track.name ?? '' },
          { header: 'LABEL', value: (r) => truncate(r.track.label ?? '', 30) },
          { header: 'VOL', value: (r) => r.track.volume.toFixed(2) },
          { header: 'OPACITY', value: (r) => r.track.opacity.toFixed(2) },
          { header: 'FLAGS', value: (r) => trackFlags(r) },
          { header: 'CLIPS', value: (r) => String(r.clipCount) },
        ],
        {
          json: opts.json,
          totalItems: result.totalItems,
          hint: 'address tracks by layer number or id',
        }
      );
    } catch (err) {
      handleError(err);
    }
  });

  const update = track
    .command('update <trackRef>')
    .description(
      'Update track settings (name, volume, opacity, mute, lock, layer)'
    )
    .option(
      '-t, --timeline <id>',
      'timeline id (required when <trackRef> is a bare layer number)'
    )
    .option('--muted', 'mute the track')
    .option('--no-muted', 'unmute the track')
    .option('--locked', 'lock the track')
    .option('--no-locked', 'unlock the track')
    .option(
      '--layer <n>',
      'move to this layer (swaps with its current holder)',
      parseLayer
    );
  applyOptions(withJsonOption(update), trackFieldOptions).action(
    async (trackRef: string, opts) => {
      try {
        const pb = await requireClient();
        const result = await updateTrack(pb, {
          track: trackRef,
          timelineId: opts.timeline,
          muted: opts.muted,
          locked: opts.locked,
          layer: opts.layer,
          ...pickOptions(opts, trackFieldOptions),
        });
        if (opts.json) {
          printRecord(result, [], true);
          return;
        }
        success(
          `Updated track ${result.track.id} "${result.track.name}" (layer ${result.track.layer})`
        );
        if (result.swappedWith) {
          info(
            `  swapped layers with ${result.swappedWith.id} "${result.swappedWith.name}" (now layer ${result.swappedWith.layer})`
          );
        }
      } catch (err) {
        handleError(err);
      }
    }
  );

  track
    .command('delete <trackRef>')
    .description('Delete a track (refuses when it still has clips)')
    .option(
      '-t, --timeline <id>',
      'timeline id (required when <trackRef> is a bare layer number)'
    )
    .option('--clips', "also delete the track's clips")
    .action(async (trackRef: string, opts) => {
      try {
        const pb = await requireClient();
        const result = await deleteTrack(pb, {
          track: trackRef,
          timelineId: opts.timeline,
          deleteClips: opts.clips,
        });
        success(
          `Deleted track ${result.track.id} "${result.track.name}" (layer ${result.track.layer})`
        );
        if (result.deletedClipIds.length > 0) {
          info(`  deleted clips: ${result.deletedClipIds.join(', ')}`);
        }
      } catch (err) {
        handleError(err);
      }
    });
}
