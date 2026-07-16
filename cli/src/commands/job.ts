import type { Command } from 'commander';
import { LABEL_JOB_TYPES, type TypedPocketBase } from '@project/shared';
import { handleError, requireClient } from '../lib/run.js';
import { pickMedia, resolveWorkspaceId } from '../lib/select.js';
import {
  createLabelJobTask,
  createTranscodeJobTask,
  parseLabelJobTypes,
  parseTranscodeAssets,
  TRANSCODE_ASSETS,
} from '../lib/job.js';
import { parseUnitInterval, withJsonOption } from '../lib/options.js';
import { printRecord } from '../lib/output.js';

/** `-m` flag → interactive media picker (workspace flag only used then). */
async function resolveMediaId(
  pb: TypedPocketBase,
  opts: { media?: string; workspace?: string }
): Promise<string> {
  if (opts.media) return opts.media;
  const workspaceId = await resolveWorkspaceId(pb, opts.workspace);
  return (await pickMedia(pb, workspaceId)).id;
}

export function registerJobCommands(program: Command): void {
  const job = program
    .command('job')
    .description(
      '(dev) Manually queue worker jobs for a media item — re-run transcode ' +
        'or label detection'
    );

  const label = job
    .command('label')
    .description(
      '(dev) Queue label detection (a detect_labels task) for a media item'
    )
    .option('-w, --workspace <id>', 'workspace id override')
    .option('-m, --media <id>', 'source media id')
    .option(
      '-t, --types <types>',
      `comma-separated label types to run: ${LABEL_JOB_TYPES.join(', ')} ` +
        "(default: all; intent only — the worker's ENABLE_* env flags gate " +
        'what actually runs)',
      parseLabelJobTypes
    )
    .option(
      '--confidence <threshold>',
      'detection confidence threshold, 0–1 (default: 0.5)',
      parseUnitInterval
    );
  withJsonOption(label).action(async (opts) => {
    try {
      const pb = await requireClient();
      const mediaId = await resolveMediaId(pb, opts);
      const { task, types } = await createLabelJobTask(pb, {
        mediaId,
        types: opts.types,
        confidence: opts.confidence,
      });
      printRecord(
        task,
        [
          `✓ Queued detect_labels task ${task.id} for media ${mediaId} ` +
            `(types: ${types.join(', ')})`,
          `  A running worker picks it up; results: vw label list -m ${mediaId}`,
        ],
        opts.json
      );
    } catch (err) {
      handleError(err);
    }
  });

  const transcode = job
    .command('transcode')
    .description(
      '(dev) Queue transcode/preview generation (a process_upload task) for ' +
        'a media item'
    )
    .option('-w, --workspace <id>', 'workspace id override')
    .option('-m, --media <id>', 'source media id')
    .option(
      '-a, --assets <assets>',
      `comma-separated assets to regenerate: ${TRANSCODE_ASSETS.join(', ')} ` +
        '(default: all that apply to the media type)',
      parseTranscodeAssets
    );
  withJsonOption(transcode).action(async (opts) => {
    try {
      const pb = await requireClient();
      const mediaId = await resolveMediaId(pb, opts);
      const { task, assets } = await createTranscodeJobTask(pb, {
        mediaId,
        assets: opts.assets,
      });
      printRecord(
        task,
        [
          `✓ Queued process_upload task ${task.id} for media ${mediaId} ` +
            `(assets: ${assets.join(', ')})`,
          '  A running worker picks it up; regenerated files replace the ' +
            'current previews when it completes.',
        ],
        opts.json
      );
    } catch (err) {
      handleError(err);
    }
  });
}
