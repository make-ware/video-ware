import type { Command } from 'commander';
import { CaptionMutator, type Caption, type CaptionCue } from '@project/shared';
import { handleError, requireClient } from '../lib/run.js';
import { resolveWorkspaceId } from '../lib/select.js';
import {
  captionCreateOptions,
  captionLabel,
  captionStyleOptions,
  captionTypeOf,
  captionUpdateOptions,
  createCaption,
  deleteCaption,
  updateCaption,
} from '../lib/caption.js';
import { applyOptions, pickOptions, withJsonOption } from '../lib/options.js';
import {
  info,
  printList,
  printRecord,
  success,
  truncate,
} from '../lib/output.js';

/** Exact seconds — captions are short, so `m:ss` rounding hides detail. */
const secs = (v: number) => `${v.toFixed(2)}s`;

/** Shared column layout for `caption list`. */
const captionColumns = [
  { header: 'ID', value: (c: Caption) => c.id },
  { header: 'TYPE', value: (c: Caption) => captionTypeOf(c) },
  { header: 'NAME', value: (c: Caption) => truncate(c.name ?? '', 24) },
  { header: 'TEXT', value: (c: Caption) => truncate(c.text ?? '', 40) },
  { header: 'DUR', value: (c: Caption) => secs(c.duration) },
  {
    header: 'CUES',
    value: (c: Caption) =>
      String(((c.cues ?? []) as CaptionCue[]).length || '—'),
  },
  { header: 'MEDIA', value: (c: Caption) => c.MediaRef ?? '' },
];

export function registerCaptionCommands(program: Command): void {
  const caption = program
    .command('caption')
    .alias('cap')
    .description('Create and manage captions and title cards');

  // --- create ---------------------------------------------------------------
  const create = caption
    .command('create')
    .description('Create a caption (subtitle) or a title card')
    .option('-w, --workspace <id>', 'workspace id override')
    .option(
      '--animate',
      'split the text into evenly-timed cues (one per line)'
    );
  applyOptions(
    applyOptions(withJsonOption(create), captionCreateOptions),
    captionStyleOptions
  ).action(async (opts) => {
    try {
      const pb = await requireClient();
      const workspaceId = await resolveWorkspaceId(pb, opts.workspace);
      const created = await createCaption(pb, {
        workspaceId,
        animate: !!opts.animate,
        ...pickOptions(opts, captionCreateOptions),
        ...pickOptions(opts, captionStyleOptions),
      });
      if (opts.json) {
        printRecord(created, [], true);
        return;
      }
      const cueCount = (created.cues ?? []).length;
      success(
        `Created ${captionTypeOf(created)} ${created.id} "${truncate(
          captionLabel(created),
          40
        )}" (${secs(created.duration)}${cueCount ? `, ${cueCount} cues` : ''})`
      );
      info(
        `  place it with \`vw timeline insert -t <timelineId> --caption ${created.id} --track <layer>\``
      );
    } catch (err) {
      handleError(err);
    }
  });

  // --- list -----------------------------------------------------------------
  withJsonOption(
    caption
      .command('list')
      .alias('ls')
      .description('List captions in the active workspace')
      .option('-w, --workspace <id>', 'workspace id override')
      .option(
        '--all',
        'include media-attached transcript captions (default: ad-hoc only)'
      )
  ).action(async (opts) => {
    try {
      const pb = await requireClient();
      const workspaceId = await resolveWorkspaceId(pb, opts.workspace);
      const result = await new CaptionMutator(pb).getByWorkspace(
        workspaceId,
        !opts.all,
        1,
        200
      );
      printList(result.items, captionColumns, {
        json: opts.json,
        totalItems: result.totalItems,
        hint: '`vw timeline insert --caption <id>` places one on a track',
      });
    } catch (err) {
      handleError(err);
    }
  });

  // --- show -----------------------------------------------------------------
  withJsonOption(
    caption.command('show <captionId>').description('Show one caption record')
  ).action(async (captionId: string, opts) => {
    try {
      const pb = await requireClient();
      const record = await new CaptionMutator(pb).getById(captionId);
      if (!record) {
        throw new Error(`Caption not found: ${captionId}`);
      }
      if (opts.json) {
        printRecord(record, [], true);
        return;
      }
      const cues = (record.cues ?? []) as CaptionCue[];
      info(
        `Caption ${record.id} — ${captionTypeOf(record)}, ${secs(record.duration)}`
      );
      if (record.name) info(`  name: ${record.name}`);
      info(`  text: ${truncate(record.text, 80)}`);
      if (record.MediaRef) info(`  media: ${record.MediaRef}`);
      if (cues.length > 0) {
        info(`  cues (${cues.length}):`);
        for (const cue of cues) {
          info(
            `    ${secs(cue.start)}–${secs(cue.end)}  ${truncate(cue.text, 60)}`
          );
        }
      }
      if (record.style) {
        info(`  style: ${JSON.stringify(record.style)}`);
      }
    } catch (err) {
      handleError(err);
    }
  });

  // --- update ---------------------------------------------------------------
  const update = caption
    .command('update <captionId>')
    .description('Update a caption (edits every timeline clip that uses it)')
    .option('--animate', 'regenerate cues from the text and duration');
  applyOptions(
    applyOptions(withJsonOption(update), captionUpdateOptions),
    captionStyleOptions
  ).action(async (captionId: string, opts) => {
    try {
      const pb = await requireClient();
      const updated = await updateCaption(pb, captionId, {
        ...(opts.animate ? { animate: true } : {}),
        ...pickOptions(opts, captionUpdateOptions),
        ...pickOptions(opts, captionStyleOptions),
      });
      if (opts.json) {
        printRecord(updated, [], true);
        return;
      }
      success(
        `Updated ${captionTypeOf(updated)} ${updated.id} "${truncate(
          captionLabel(updated),
          40
        )}"`
      );
    } catch (err) {
      handleError(err);
    }
  });

  // --- delete ---------------------------------------------------------------
  withJsonOption(
    caption
      .command('delete <captionId>')
      .alias('rm')
      .description(
        'Delete a caption (refuses when timeline clips still use it)'
      )
      .option('--force', 'delete even when timeline clips reference it')
  ).action(async (captionId: string, opts) => {
    try {
      const pb = await requireClient();
      const result = await deleteCaption(pb, captionId, { force: opts.force });
      if (opts.json) {
        printRecord(result, [], true);
        return;
      }
      success(`Deleted caption ${result.caption.id}`);
      if (result.referencingClipIds.length > 0) {
        info(
          `  ${result.referencingClipIds.length} timeline clip(s) now have a dangling ` +
            `caption ref (${result.referencingClipIds.join(', ')}) — remove them.`
        );
      }
    } catch (err) {
      handleError(err);
    }
  });
}
