import type { Command } from 'commander';
import { EntityKind, EntityMutator, type LabelEntity } from '@project/shared';
import { handleError, requireClient } from '../lib/run.js';
import { resolveWorkspaceId } from '../lib/select.js';
import {
  applyEntityLinks,
  distinctMedia,
  entityAppearancesSpec,
  entityLabelsSpec,
  entityListSpec,
  entityWordsSpec,
  fetchEntityAppearancePage,
  fetchEntityPage,
  fetchEntityWordsPage,
  formatEntityTranscript,
  getEntityAppearances,
  getEntityTaggedMedia,
  linkTargetOptions,
  parseAliases,
  parseEntityKind,
  resolveEntity,
  resolveLinkTargets,
  type EntityAppearance,
  type EntityTaggedMedia,
} from '../lib/entity.js';
import {
  fetchAll,
  runList,
  runMergedList,
  withListOptions,
} from '../lib/list/index.js';
import {
  labelHitCompare,
  labelMergeSources,
  labelPerTypeClauses,
  resolveLabelTypes,
} from '../lib/label.js';
import { ENTITY_HELP } from '../lib/help.js';
import { applyOptions, pickOptions, withJsonOption } from '../lib/options.js';
import {
  formatDuration,
  info,
  printList,
  printRecord,
  success,
  type Column,
} from '../lib/output.js';

const appearanceColumns: Column<EntityAppearance>[] = [
  { header: 'MEDIA', value: (a) => a.mediaName },
  { header: 'TYPE', value: (a) => a.labelType || '?' },
  { header: 'TRACK', value: (a) => a.track.trackId },
  { header: 'START', value: (a) => `${a.track.start.toFixed(2)}s` },
  { header: 'END', value: (a) => `${a.track.end.toFixed(2)}s` },
  { header: 'DUR', value: (a) => formatDuration(a.track.duration) },
];

/**
 * ` (Speaker 1, Face 3)` — the written rows named, so a link/unlink report
 * says which instances it landed on rather than only how many.
 */
function namesOf(rows: LabelEntity[]): string {
  const names = rows.map((row) => row.canonicalName).filter(Boolean);
  return names.length > 0 ? ` (${names.join(', ')})` : '';
}

const taggedMediaColumns: Column<EntityTaggedMedia>[] = [
  { header: 'MEDIA ID', value: (t) => t.mediaId },
  { header: 'NAME', value: (t) => t.mediaName },
  { header: 'TYPE', value: (t) => t.mediaType },
  { header: 'DURATION', value: (t) => formatDuration(t.duration) },
];

export function registerEntityCommands(program: Command): void {
  const entity = program
    .command('entity')
    .description(
      'Name the people and things in your media, then find them by that name'
    )
    .addHelpText('after', ENTITY_HELP);

  const create = entity
    .command('create <name>')
    .description('Create an entity (a person unless --kind says otherwise)')
    .option(
      '-k, --kind <kind>',
      `entity kind (${Object.values(EntityKind).join(', ')}; default: person)`,
      parseEntityKind
    )
    .option('-d, --description <text>', 'free-text description')
    .option(
      '--aliases <names>',
      'comma-separated alternate names',
      parseAliases
    );
  withJsonOption(create).action(async (name: string, opts) => {
    try {
      const pb = await requireClient();
      const workspaceId = await resolveWorkspaceId(pb);
      const created = await new EntityMutator(pb).create({
        WorkspaceRef: workspaceId,
        name,
        kind: opts.kind ?? EntityKind.PERSON,
        description: opts.description,
        aliases: opts.aliases,
      });
      printRecord(
        created,
        [
          `✓ Created ${created.kind} entity ${created.id} "${created.name}"`,
          `vw entity link "${created.name}" --speaker <mediaId>:<speakerId> (or --face/--track/--cluster/--label) attributes labels to it`,
          `vw label tag <type> <labelId> "${created.name}" tags a single label's instance; vw label search --entity "${created.name}" finds everything attributed to it`,
        ],
        opts.json
      );
    } catch (err) {
      handleError(err);
    }
  });

  withListOptions(
    entity
      .command('list [query]')
      .alias('ls')
      .description("List (or fuzzy-search) the workspace's entities"),
    entityListSpec
  ).action(async (query: string | undefined, opts) => {
    try {
      const pb = await requireClient();
      const ctx = {
        pb,
        workspaceId: await resolveWorkspaceId(pb),
      };
      await runList({
        spec: entityListSpec,
        // The positional query is the --search filter, so both forms compose
        // with --kind and page identically.
        opts: { ...opts, search: opts.search ?? query },
        ctx,
        fetchPage: (resolved) => fetchEntityPage(pb, resolved),
      });
    } catch (err) {
      handleError(err);
    }
  });

  const show = entity
    .command('show <nameOrId>')
    .description(
      'Show one entity: its appearances and the media tagged with it'
    );
  withJsonOption(show).action(async (nameOrId: string, opts) => {
    try {
      const pb = await requireClient();
      const workspaceId = await resolveWorkspaceId(pb);
      const found = await resolveEntity(pb, workspaceId, nameOrId);
      const { appearances, totalItems } = await getEntityAppearances(
        pb,
        found.id,
        { limit: 20 }
      );
      const media = distinctMedia(appearances.map((a) => a.track));
      const taggedMedia = await getEntityTaggedMedia(pb, found.id, 20);

      if (opts.json) {
        printRecord(
          {
            ...found,
            appearances,
            totalItems,
            taggedMedia: taggedMedia.tagged,
            taggedMediaTotal: taggedMedia.totalItems,
          },
          [],
          true
        );
        return;
      }
      const aliases = Array.isArray(found.aliases)
        ? (found.aliases as string[])
        : [];
      info(
        `${found.kind} entity ${found.id} "${found.name}"` +
          (aliases.length > 0 ? ` (aka ${aliases.join(', ')})` : '')
      );
      if (found.description) info(found.description);
      info(
        `appears in ${media.length} media via ${totalItems} linked track(s)`
      );
      printList(appearances, appearanceColumns, {
        totalItems,
        hint: 'vw entity words/appearances <name|id> queries across all media',
      });
      if (taggedMedia.tagged.length > 0) {
        info('');
        info(`tagged on ${taggedMedia.totalItems} media:`);
        printList(taggedMedia.tagged, taggedMediaColumns, {
          totalItems: taggedMedia.totalItems,
          hint: 'vw media untag <mediaId> <entity> removes a tag',
        });
      }
    } catch (err) {
      handleError(err);
    }
  });

  const link = entity
    .command('link <nameOrId>')
    .description(
      'Link detected instances — a speaker, face, track, cluster, or label — to an entity'
    );
  applyOptions(link, linkTargetOptions);
  link.action(async (nameOrId: string, opts) => {
    try {
      const pb = await requireClient();
      const workspaceId = await resolveWorkspaceId(pb);
      const found = await resolveEntity(pb, workspaceId, nameOrId);
      const targets = await resolveLinkTargets(
        pb,
        pickOptions(opts, linkTargetOptions)
      );
      const linked = await applyEntityLinks(pb, found.id, targets);
      success(
        `Linked ${linked.length} label instance(s) to ${found.kind} "${found.name}"` +
          namesOf(linked)
      );
    } catch (err) {
      handleError(err);
    }
  });

  const unlink = entity
    .command('unlink')
    .description('Unlink detected instances — same targets as link');
  applyOptions(unlink, linkTargetOptions);
  unlink.action(async (opts) => {
    try {
      const pb = await requireClient();
      const targets = await resolveLinkTargets(
        pb,
        pickOptions(opts, linkTargetOptions)
      );
      const unlinked = await applyEntityLinks(pb, null, targets);
      success(
        `Unlinked ${unlinked.length} label instance(s)` + namesOf(unlinked)
      );
    } catch (err) {
      handleError(err);
    }
  });

  withListOptions(
    entity
      .command('words <nameOrId>')
      .description('Everything the entity said, across every media')
      .option('--text', 'print a plain transcript instead of a table'),
    entityWordsSpec
  ).action(async (nameOrId: string, opts) => {
    try {
      const pb = await requireClient();
      const workspaceId = await resolveWorkspaceId(pb);
      const found = await resolveEntity(pb, workspaceId, nameOrId);

      // --text is a whole-transcript rendering, not a table: it walks every
      // page so the transcript is complete regardless of the page size.
      if (opts.text) {
        const utterances = await fetchAll((page) =>
          fetchEntityWordsPage(pb, found.id, {
            page,
            perPage: 200,
            filter: opts.media
              ? pb.filter('MediaRef = {:m}', { m: opts.media })
              : '',
            // The id tiebreak matters here like everywhere labels page:
            // aligned words share MediaRef+start, and a non-total order can
            // duplicate or drop rows at an OFFSET page boundary.
            sort: 'MediaRef,start,id',
          })
        );
        info(formatEntityTranscript(utterances));
        return;
      }

      await runList({
        spec: entityWordsSpec,
        opts,
        ctx: { pb, workspaceId },
        fetchPage: (query) => fetchEntityWordsPage(pb, found.id, query),
      });
    } catch (err) {
      handleError(err);
    }
  });

  withListOptions(
    entity
      .command('labels <nameOrId>')
      .description('Every label attributed to the entity, all types and media'),
    entityLabelsSpec,
    { merged: true }
  ).action(async (nameOrId: string, opts) => {
    try {
      const pb = await requireClient();
      const workspaceId = await resolveWorkspaceId(pb);
      const found = await resolveEntity(pb, workspaceId, nameOrId);
      const types = resolveLabelTypes(opts);

      await runMergedList({
        spec: entityLabelsSpec,
        opts,
        ctx: { pb, workspaceId },
        compare: (resolved) => labelHitCompare(resolved.sort),
        narrowWith: '-t <type>, -m <mediaId>',
        sources: (resolved) =>
          labelMergeSources(pb, {
            types,
            baseFilter: resolved.filter,
            sort: resolved.sort,
            perType: labelPerTypeClauses(pb, {
              ...opts,
              entityId: found.id,
            }),
            expand: ['MediaRef.UploadRef'],
          }),
      });
    } catch (err) {
      handleError(err);
    }
  });

  withListOptions(
    entity
      .command('appearances <nameOrId>')
      .description(
        'When the entity is on screen or speaking — time ranges, per media'
      ),
    entityAppearancesSpec
  ).action(async (nameOrId: string, opts) => {
    try {
      const pb = await requireClient();
      const workspaceId = await resolveWorkspaceId(pb);
      const found = await resolveEntity(pb, workspaceId, nameOrId);
      await runList({
        spec: entityAppearancesSpec,
        opts,
        ctx: { pb, workspaceId },
        fetchPage: (query) => fetchEntityAppearancePage(pb, found.id, query),
      });
    } catch (err) {
      handleError(err);
    }
  });
}
