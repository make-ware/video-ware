import type { Command } from 'commander';
import { MediaClipLabelMutator, overlapsSegments } from '@project/shared';
import { handleError, requireClient } from '../lib/run.js';
import { resolveWorkspaceId } from '../lib/select.js';
import {
  attributedEntitySummaryOf,
  clipEditListFilter,
  clipMetaOptions,
  confidenceOf,
  createClipFromLabel,
  getLabel,
  LABEL_TYPE_CONFIG,
  labelHitCompare,
  labelListSpec,
  labelMergeSources,
  labelPerTypeClauses,
  labelSearchSpec,
  parseLabelType,
  resolveLabelTypes,
  type ClipEditListFilter,
  type LabelHit,
} from '../lib/label.js';
import { resolveEntity, tagLabel } from '../lib/entity.js';
import { applyOptions, pickOptions, withJsonOption } from '../lib/options.js';
import { runMergedList, withListOptions } from '../lib/list/index.js';
import {
  formatDuration,
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

  withListOptions(
    label
      .command('search [query]')
      .alias('find')
      .description(
        'Search workspace labels by text (transcript/entity), exact id, or attributed entity'
      ),
    labelSearchSpec,
    { merged: true }
  ).action(async (query: string | undefined, opts) => {
    try {
      const pb = await requireClient();
      const workspaceId = await resolveWorkspaceId(pb);
      // The positional query is the --search filter, so both spellings
      // compose with the other flags identically.
      const merged = { ...opts, search: opts.search ?? query };
      const entityId = merged.entity
        ? (await resolveEntity(pb, workspaceId, merged.entity)).id
        : undefined;
      const types = resolveLabelTypes(merged);

      await runMergedList({
        spec: labelSearchSpec,
        opts: merged,
        ctx: { pb, workspaceId },
        // The resolved sort drives both the per-source server sort and this
        // comparator, so they cannot drift apart.
        compare: (resolved) => labelHitCompare(resolved.sort),
        narrowWith: '-t <type>, -m <mediaId>',
        sources: (resolved) =>
          labelMergeSources(pb, {
            types,
            baseFilter: resolved.filter,
            sort: resolved.sort,
            perType: labelPerTypeClauses(pb, { ...merged, entityId }),
            expand: ['MediaRef.UploadRef'],
          }),
      });
    } catch (err) {
      handleError(err);
    }
  });

  withListOptions(
    label.command('list').alias('ls').description('List labels for one media'),
    labelListSpec,
    { merged: true }
  ).action(async (opts) => {
    try {
      const pb = await requireClient();

      if (opts.clip && opts.timelineClip) {
        throw new Error('Pass --clip or --timeline-clip, not both.');
      }
      const clipScoped = Boolean(opts.clip || opts.timelineClip);
      if (clipScoped && (opts.from !== undefined || opts.to !== undefined)) {
        throw new Error(
          '--from/--to cannot be combined with --clip/--timeline-clip — the clip supplies its own window.'
        );
      }

      // A clip scope resolves to exactly what the spec's own flags express: the
      // clip's media, and its outer span as the coarse window. Only the cut
      // gaps inside that span need the in-memory refinement below.
      let editList: ClipEditListFilter | undefined;
      const scope: Record<string, unknown> = {};
      if (clipScoped) {
        editList = await clipEditListFilter(pb, {
          clip: opts.clip,
          timelineClip: opts.timelineClip,
        });
        if (opts.media && opts.media !== editList.mediaId) {
          throw new Error(
            `Clip ${opts.clip ?? opts.timelineClip} belongs to media ${editList.mediaId}, not ${opts.media} — drop -m.`
          );
        }
        scope.media = editList.mediaId;
        scope.from = Math.min(...editList.segments.map((s) => s.start));
        scope.to = Math.max(...editList.segments.map((s) => s.end));
      }
      const merged = { ...opts, ...scope };

      const workspaceId = await resolveWorkspaceId(pb);
      const entityId = merged.entity
        ? (await resolveEntity(pb, workspaceId, merged.entity)).id
        : undefined;
      const types = resolveLabelTypes(merged);

      const segments = editList?.segments;
      await runMergedList({
        spec: labelListSpec,
        opts: merged,
        ctx: { pb, workspaceId },
        // The resolved sort drives both the per-source server sort and this
        // comparator, so they cannot drift apart.
        compare: (resolved) => labelHitCompare(resolved.sort),
        narrowWith: '-t <type>',
        // Edit-list scope means "what plays": the server window is the outer
        // span, so labels landing entirely in a cut gap can only go here.
        refine: segments && {
          filter: (hits) =>
            hits.filter((h) =>
              overlapsSegments(h.record.start, h.record.end, segments)
            ),
          extras: (hidden) => ({
            editList: { segments, source: editList!.source },
            hiddenInCutGaps: hidden,
          }),
          note: (hidden) =>
            `(edit-list filtered: ${hidden} label(s) inside cut gaps hidden)`,
        },
        sources: (resolved) =>
          labelMergeSources(pb, {
            types,
            baseFilter: resolved.filter,
            sort: resolved.sort,
            perType: labelPerTypeClauses(pb, { ...merged, entityId }),
          }),
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
    );
  withJsonOption(tag).action(
    async (typeArg: string, labelId: string, entityNameOrId: string, opts) => {
      try {
        const pb = await requireClient();
        const workspaceId = await resolveWorkspaceId(pb);
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
