import type { Command } from 'commander';
import { EntityKind, EntityMutator } from '@project/shared';
import { handleError, requireClient } from '../lib/run.js';
import { resolveWorkspaceId } from '../lib/select.js';
import {
  applyEntityLinks,
  distinctMedia,
  formatEntityTranscript,
  getEntityAppearances,
  getEntityWords,
  linkTargetOptions,
  mediaNameOf,
  parseAliases,
  parseEntityKind,
  resolveEntity,
  resolveLinkTargets,
  type EntityAppearance,
  type EntityUtterance,
} from '../lib/entity.js';
import { applyOptions, pickOptions, withJsonOption } from '../lib/options.js';
import {
  formatDuration,
  info,
  printList,
  printRecord,
  success,
  truncate,
  type Column,
} from '../lib/output.js';

const appearanceColumns: Column<EntityAppearance>[] = [
  { header: 'MEDIA', value: (a) => a.mediaName },
  { header: 'TYPE', value: (a) => a.labelType || '?' },
  { header: 'TRACK', value: (a) => a.track.trackId },
  { header: 'START', value: (a) => `${a.track.start.toFixed(2)}s` },
  { header: 'END', value: (a) => `${a.track.end.toFixed(2)}s` },
  { header: 'DUR', value: (a) => formatDuration(a.track.duration) },
  { header: 'VIA', value: (a) => a.via },
];

const utteranceColumns: Column<EntityUtterance>[] = [
  { header: 'MEDIA', value: (u) => mediaNameOf(u) },
  { header: 'START', value: (u) => `${u.start.toFixed(2)}s` },
  { header: 'END', value: (u) => `${u.end.toFixed(2)}s` },
  { header: 'TEXT', value: (u) => truncate(u.transcript, 70) },
];

export function registerEntityCommands(program: Command): void {
  const entity = program
    .command('entity')
    .description(
      'Real-world entities (people, products, places, things) — create them, link label tracks/clusters, and query appearances and spoken words across media'
    );

  const create = entity
    .command('create <name>')
    .description('Create an entity in the workspace')
    .option('-w, --workspace <id>', 'workspace id override')
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
      const workspaceId = await resolveWorkspaceId(pb, opts.workspace);
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
        ],
        opts.json
      );
    } catch (err) {
      handleError(err);
    }
  });

  const list = entity
    .command('list [query]')
    .alias('ls')
    .description("List (or fuzzy-search) the workspace's entities")
    .option('-w, --workspace <id>', 'workspace id override')
    .option(
      '-k, --kind <kind>',
      `only this kind (${Object.values(EntityKind).join(', ')})`,
      parseEntityKind
    );
  withJsonOption(list).action(async (query: string | undefined, opts) => {
    try {
      const pb = await requireClient();
      const workspaceId = await resolveWorkspaceId(pb, opts.workspace);
      const mutator = new EntityMutator(pb);
      const result = query
        ? await mutator.search(workspaceId, query)
        : await mutator.getByWorkspace(workspaceId, opts.kind);
      const items = opts.kind
        ? result.items.filter((e) => e.kind === opts.kind)
        : result.items;
      printList(
        items,
        [
          { header: 'ID', value: (e) => e.id },
          { header: 'KIND', value: (e) => String(e.kind) },
          { header: 'NAME', value: (e) => e.name },
          {
            header: 'DESCRIPTION',
            value: (e) => truncate(e.description ?? '', 50),
          },
        ],
        {
          json: opts.json,
          totalItems: result.totalItems,
          hint: 'vw entity show <name|id> shows links and appearances',
        }
      );
    } catch (err) {
      handleError(err);
    }
  });

  const show = entity
    .command('show <nameOrId>')
    .description('Show one entity with its linked tracks and appearances')
    .option('-w, --workspace <id>', 'workspace id override');
  withJsonOption(show).action(async (nameOrId: string, opts) => {
    try {
      const pb = await requireClient();
      const workspaceId = await resolveWorkspaceId(pb, opts.workspace);
      const found = await resolveEntity(pb, workspaceId, nameOrId);
      const { appearances, totalItems } = await getEntityAppearances(
        pb,
        found.id,
        { limit: 20 }
      );
      const media = distinctMedia(appearances.map((a) => a.track));

      if (opts.json) {
        printRecord({ ...found, appearances, totalItems }, [], true);
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
    } catch (err) {
      handleError(err);
    }
  });

  const link = entity
    .command('link <nameOrId>')
    .description(
      'Attribute label tracks or provider clusters to an entity (repeatable across media, or within one media when the provider id changes)'
    )
    .option('-w, --workspace <id>', 'workspace id override');
  applyOptions(link, linkTargetOptions);
  link.action(async (nameOrId: string, opts) => {
    try {
      const pb = await requireClient();
      const workspaceId = await resolveWorkspaceId(pb, opts.workspace);
      const found = await resolveEntity(pb, workspaceId, nameOrId);
      const targets = await resolveLinkTargets(
        pb,
        pickOptions(opts, linkTargetOptions)
      );
      const { tracks, clusters } = await applyEntityLinks(
        pb,
        found.id,
        targets
      );
      success(
        `Linked ${tracks.length} track(s) and ${clusters.length} cluster(s) to ${found.kind} "${found.name}"`
      );
    } catch (err) {
      handleError(err);
    }
  });

  const unlink = entity
    .command('unlink')
    .description('Clear the entity link on label tracks or provider clusters')
    .option('-w, --workspace <id>', 'workspace id override');
  applyOptions(unlink, linkTargetOptions);
  unlink.action(async (opts) => {
    try {
      const pb = await requireClient();
      const targets = await resolveLinkTargets(
        pb,
        pickOptions(opts, linkTargetOptions)
      );
      const { tracks, clusters } = await applyEntityLinks(pb, null, targets);
      success(
        `Unlinked ${tracks.length} track(s) and ${clusters.length} cluster(s)`
      );
    } catch (err) {
      handleError(err);
    }
  });

  const words = entity
    .command('words <nameOrId>')
    .description(
      'Everything the entity said across media (diarized speaker labels)'
    )
    .option('-w, --workspace <id>', 'workspace id override')
    .option('-m, --media <id>', 'restrict to one media')
    .option('--text', 'print a plain transcript instead of a table')
    .option('-n, --limit <count>', 'max utterances (default: 200)', (v) =>
      parseInt(v, 10)
    );
  withJsonOption(words).action(async (nameOrId: string, opts) => {
    try {
      const pb = await requireClient();
      const workspaceId = await resolveWorkspaceId(pb, opts.workspace);
      const found = await resolveEntity(pb, workspaceId, nameOrId);
      const { utterances, totalItems } = await getEntityWords(pb, found.id, {
        media: opts.media,
        limit: opts.limit,
      });
      if (opts.text) {
        info(formatEntityTranscript(utterances));
        return;
      }
      printList(utterances, utteranceColumns, {
        json: opts.json,
        totalItems,
        hint: 'add --text for a plain transcript',
      });
    } catch (err) {
      handleError(err);
    }
  });

  const appearances = entity
    .command('appearances <nameOrId>')
    .description(
      'When the entity is on screen / speaking, per media (linked track ranges)'
    )
    .option('-w, --workspace <id>', 'workspace id override')
    .option('-m, --media <id>', 'restrict to one media')
    .option('-n, --limit <count>', 'max tracks (default: 100)', (v) =>
      parseInt(v, 10)
    );
  withJsonOption(appearances).action(async (nameOrId: string, opts) => {
    try {
      const pb = await requireClient();
      const workspaceId = await resolveWorkspaceId(pb, opts.workspace);
      const found = await resolveEntity(pb, workspaceId, nameOrId);
      const result = await getEntityAppearances(pb, found.id, {
        media: opts.media,
        limit: opts.limit,
      });
      printList(result.appearances, appearanceColumns, {
        json: opts.json,
        totalItems: result.totalItems,
        hint: 'vw label clip <type> <labelId> turns a label into a clip',
      });
    } catch (err) {
      handleError(err);
    }
  });
}
