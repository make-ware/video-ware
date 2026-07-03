import type { Command } from 'commander';
import { MediaClipLabelMutator } from '@project/shared';
import { handleError, requireClient } from '../lib/run.js';
import { pickMedia, resolveWorkspaceId } from '../lib/select.js';
import {
  clipMetaOptions,
  confidenceOf,
  createClipFromLabel,
  getLabel,
  LABEL_TYPE_CONFIG,
  labelMediaName,
  labelSearchOptions,
  listLabels,
  parseLabelType,
  parseLabelTypes,
  searchLabels,
  type LabelHit,
} from '../lib/label.js';
import { applyOptions, pickOptions, withJsonOption } from '../lib/options.js';
import {
  formatDuration,
  printList,
  printRecord,
  truncate,
  type Column,
} from '../lib/output.js';

/** Shared column layout for `label search` (MEDIA) and `label list` (TEXT). */
const hitColumns = (withMedia: boolean): Column<LabelHit>[] => [
  { header: 'TYPE', value: (h) => h.type },
  { header: 'ID', value: (h) => h.record.id },
  ...(withMedia
    ? [{ header: 'MEDIA', value: (h: LabelHit) => labelMediaName(h) }]
    : []),
  { header: 'START', value: (h) => `${h.record.start.toFixed(2)}s` },
  { header: 'END', value: (h) => `${h.record.end.toFixed(2)}s` },
  { header: 'CONF', value: (h) => confidenceOf(h).toFixed(2) },
  {
    header: withMedia ? 'MATCH' : 'TEXT',
    value: (h) => truncate(LABEL_TYPE_CONFIG[h.type].snippet(h.record)),
  },
];

export function registerLabelCommands(program: Command): void {
  const label = program
    .command('label')
    .description(
      'Search and browse media labels (speech, objects, faces, …) and create clips from them'
    );

  const search = label
    .command('search [query]')
    .alias('find')
    .description(
      'Search workspace labels by text (transcript/entity) or exact id'
    )
    .option('-w, --workspace <id>', 'workspace id override');
  applyOptions(search, labelSearchOptions);
  withJsonOption(search).action(async (query: string | undefined, opts) => {
    try {
      const pb = await requireClient();
      const workspaceId = await resolveWorkspaceId(pb, opts.workspace);
      const { hits, totalItems } = await searchLabels(pb, {
        workspaceId,
        query,
        ...pickOptions(opts, labelSearchOptions),
      });
      printList(hits, hitColumns(true), {
        json: opts.json,
        totalItems,
        hint: 'vw label show <type> <id> shows one record, vw label clip <type> <id> creates a clip',
      });
    } catch (err) {
      handleError(err);
    }
  });

  const list = label
    .command('list')
    .alias('ls')
    .description('List labels for one media')
    .option('-w, --workspace <id>', 'workspace id override')
    .option('-m, --media <id>', 'source media id')
    .option(
      '-t, --types <types>',
      'comma-separated label types (default: all)',
      parseLabelTypes
    )
    .option(
      '-n, --limit <count>',
      'max results per label type (default: 100)',
      (v) => parseInt(v, 10)
    );
  withJsonOption(list).action(async (opts) => {
    try {
      const pb = await requireClient();
      const workspaceId = await resolveWorkspaceId(pb, opts.workspace);

      let mediaId = opts.media as string | undefined;
      if (!mediaId) {
        mediaId = (await pickMedia(pb, workspaceId)).id;
      }

      const { hits, totalItems } = await listLabels(pb, {
        mediaId,
        types: opts.types,
        limit: opts.limit,
      });
      printList(hits, hitColumns(false), {
        json: opts.json,
        totalItems,
        hint: 'vw label show <type> <id> shows one record',
      });
    } catch (err) {
      handleError(err);
    }
  });

  const show = label
    .command('show <type> <labelId>')
    .description('Show one label record')
    .option('--clips', 'also list clips created from this label');
  withJsonOption(show).action(
    async (typeArg: string, labelId: string, opts) => {
      try {
        const pb = await requireClient();
        const type = parseLabelType(typeArg);
        const record = await getLabel(pb, type, labelId);
        if (!record) {
          throw new Error(
            `No ${type} label with id ${labelId} ` +
              `(a wrong type/id pairing also reads as not found — check the type)`
          );
        }

        const links = opts.clips
          ? (await new MediaClipLabelMutator(pb).getByLabel(type, labelId))
              .items
          : undefined;

        const hit: LabelHit = { type, record };
        const lines = [
          `${type} label ${record.id} — ${truncate(LABEL_TYPE_CONFIG[type].snippet(record), 80)}`,
          `media ${record.MediaRef}  range ${record.start.toFixed(2)}s–${record.end.toFixed(2)}s (${formatDuration(record.duration)})  confidence ${confidenceOf(hit).toFixed(2)}`,
        ];
        if (links) {
          lines.push(
            links.length > 0
              ? `linked clips: ${links.map((l) => l.MediaClipRef).join(', ')}`
              : 'linked clips: (none)'
          );
        }
        lines.push('(add --json for the full record)');
        printRecord(links ? { ...record, links } : record, lines, opts.json);
      } catch (err) {
        handleError(err);
      }
    }
  );

  const clip = label
    .command('clip <type> <labelId>')
    .description(
      'Create a media clip from a label, back-referencing it in MediaClipLabels'
    );
  applyOptions(clip, clipMetaOptions);
  withJsonOption(clip).action(
    async (typeArg: string, labelId: string, opts) => {
      try {
        const pb = await requireClient();
        const type = parseLabelType(typeArg);
        const { clip: created } = await createClipFromLabel(pb, {
          type,
          labelId,
          ...pickOptions(opts, clipMetaOptions),
        });
        const name = created.label ? ` "${created.label}"` : '';
        printRecord(
          created,
          [
            `✓ Created ${created.type} clip ${created.id}${name} (${created.start}s–${created.end}s, ${formatDuration(created.duration)}) from ${type} label ${labelId} — provenance linked in MediaClipLabels`,
            '(add --json for the full clip record)',
          ],
          opts.json
        );
      } catch (err) {
        handleError(err);
      }
    }
  );
}
