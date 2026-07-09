import type { Command } from 'commander';
import { MediaClipLabelMutator } from '@project/shared';
import { handleError, requireClient } from '../lib/run.js';
import { pickMedia, resolveWorkspaceId } from '../lib/select.js';
import {
  attributedEntitySummaryOf,
  clipMetaOptions,
  confidenceOf,
  createClipFromLabel,
  getLabel,
  hitColumns,
  LABEL_TYPE_CONFIG,
  labelSearchOptions,
  listLabels,
  parseLabelType,
  parseLabelTypes,
  searchLabels,
  type LabelHit,
} from '../lib/label.js';
import { resolveEntity, tagLabel } from '../lib/entity.js';
import { applyOptions, pickOptions, withJsonOption } from '../lib/options.js';
import {
  formatDuration,
  printList,
  printRecord,
  success,
  truncate,
} from '../lib/output.js';

/** Human summary of what a tag/untag write actually landed on. */
function tagScopeLine(result: {
  via: 'track' | 'cluster';
  targetName: string;
}): string {
  return result.via === 'track'
    ? `via its track (trackId ${result.targetName}) — identifies this ` +
        `instance across the whole media`
    : `via its provider cluster "${result.targetName}" — applies to every ` +
        `label in the cluster, workspace-wide`;
}

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
      'Search workspace labels by text (transcript/entity), exact id, or attributed entity'
    )
    .option('-w, --workspace <id>', 'workspace id override')
    .option(
      '--entity <nameOrId>',
      'only labels attributed to this entity (tagged track or cluster)'
    );
  applyOptions(search, labelSearchOptions);
  withJsonOption(search).action(async (query: string | undefined, opts) => {
    try {
      const pb = await requireClient();
      const workspaceId = await resolveWorkspaceId(pb, opts.workspace);
      const entityId = opts.entity
        ? (await resolveEntity(pb, workspaceId, opts.entity)).id
        : undefined;
      const { hits, totalItems } = await searchLabels(pb, {
        workspaceId,
        query,
        entityId,
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
      '--entity <nameOrId>',
      'only labels attributed to this entity (tagged track or cluster)'
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
      const entityId = opts.entity
        ? (await resolveEntity(pb, workspaceId, opts.entity)).id
        : undefined;

      const { hits, totalItems } = await listLabels(pb, {
        mediaId,
        types: opts.types,
        entityId,
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
        const attributed = attributedEntitySummaryOf(record);
        const lines = [
          `${type} label ${record.id} — ${truncate(LABEL_TYPE_CONFIG[type].snippet(record), 80)}`,
          `media ${record.MediaRef}  range ${record.start.toFixed(2)}s–${record.end.toFixed(2)}s (${formatDuration(record.duration)})  confidence ${confidenceOf(hit).toFixed(2)}`,
        ];
        if (attributed) {
          lines.push(
            `entity: ${attributed.name} (${attributed.kind}, ${attributed.id}) — ` +
              (attributed.via === 'track'
                ? 'tagged via its track'
                : 'tagged via its provider cluster')
          );
        }
        if (links) {
          lines.push(
            links.length > 0
              ? `linked clips: ${links.map((l) => l.MediaClipRef).join(', ')}`
              : 'linked clips: (none)'
          );
        }
        lines.push('(add --json for the full record)');
        printRecord(
          {
            ...record,
            ...(attributed ? { attributedEntity: attributed } : {}),
            ...(links ? { links } : {}),
          },
          lines,
          opts.json
        );
      } catch (err) {
        handleError(err);
      }
    }
  );

  const tag = label
    .command('tag <type> <labelId> <entityNameOrId>')
    .description(
      "Attribute a label to a real-world entity — writes the label's track " +
        'when it has one (this instance across the media), else its ' +
        'provider cluster (workspace-wide)'
    )
    .option('-w, --workspace <id>', 'workspace id override');
  withJsonOption(tag).action(
    async (typeArg: string, labelId: string, entityNameOrId: string, opts) => {
      try {
        const pb = await requireClient();
        const workspaceId = await resolveWorkspaceId(pb, opts.workspace);
        const type = parseLabelType(typeArg);
        const entity = await resolveEntity(pb, workspaceId, entityNameOrId);
        const result = await tagLabel(pb, type, labelId, entity.id);
        if (opts.json) {
          printRecord({ ...result, entity }, [], true);
          return;
        }
        success(
          `Tagged ${type} label ${labelId} → ${entity.kind} "${entity.name}" ` +
            tagScopeLine(result)
        );
      } catch (err) {
        handleError(err);
      }
    }
  );

  const untag = label
    .command('untag <type> <labelId>')
    .description(
      "Clear a label's entity attribution (from its track, or its provider cluster when trackless)"
    );
  withJsonOption(untag).action(
    async (typeArg: string, labelId: string, opts) => {
      try {
        const pb = await requireClient();
        const type = parseLabelType(typeArg);
        const result = await tagLabel(pb, type, labelId, null);
        if (opts.json) {
          printRecord(result, [], true);
          return;
        }
        success(
          `Removed entity tag from ${type} label ${labelId} ` +
            tagScopeLine(result)
        );
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
