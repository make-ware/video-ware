import { join } from 'node:path';
import type { Command } from 'commander';
import { WorkspaceMutator, type Workspace } from '@project/shared';
import { handleError, requireClient } from '../lib/run.js';
import { loadConfig, updateConfig } from '../lib/config.js';
import { pickWorkspace, resolveWorkspaceId } from '../lib/select.js';
import { withJsonOption } from '../lib/options.js';
import { info, printRecord, success } from '../lib/output.js';
import { exportWorkspace } from '../lib/export.js';
import {
  WORKSPACE_SORTS,
  listFilter,
  runList,
  withListOptions,
  type ListSpec,
} from '../lib/list/index.js';

/**
 * `workspace list`. Not workspace-scoped (it *is* the workspace list), and the
 * active workspace is marked with `*` from the local config.
 */
const workspaceListSpec: ListSpec<Workspace> = {
  command: 'workspace list',
  workspaceScoped: false,
  sorts: WORKSPACE_SORTS,
  filters: {
    search: listFilter({
      flags: '--search <text>',
      description: 'match the workspace name or slug',
      clause: (q) => ({
        expr: '(name ~ {:q} || slug ~ {:q})',
        params: { q },
      }),
    }),
  },
  columns: [
    {
      header: ' ',
      value: (w) => (w.id === loadConfig().workspaceId ? '*' : ''),
    },
    { header: 'ID', value: (w) => w.id },
    { header: 'NAME', value: (w) => w.name },
    { header: 'SLUG', value: (w) => w.slug ?? '' },
  ],
  hint: '`vw workspace use <id>` switches the active workspace',
};

export function registerWorkspaceCommands(program: Command): void {
  const ws = program
    .command('workspace')
    .alias('ws')
    .description('Manage the active workspace');

  withListOptions(
    ws.command('list').alias('ls').description('List workspaces'),
    workspaceListSpec
  ).action(async (opts) => {
    try {
      const pb = await requireClient();
      await runList({
        spec: workspaceListSpec,
        opts,
        ctx: { pb },
        fetchPage: (query) =>
          new WorkspaceMutator(pb).getList(
            query.page,
            query.perPage,
            query.filter,
            query.sort
          ),
      });
    } catch (err) {
      handleError(err);
    }
  });

  ws.command('use [workspaceId]')
    .description('Set the active workspace (interactive when no id is given)')
    .action(async (workspaceId?: string) => {
      try {
        const pb = await requireClient();
        if (workspaceId) {
          const found = await new WorkspaceMutator(pb).getById(workspaceId);
          if (!found) {
            handleError(new Error(`Workspace not found: ${workspaceId}`));
          }
          updateConfig({ workspaceId: found.id, workspaceName: found.name });
          success(`Active workspace: ${found.name} (${found.id})`);
          return;
        }
        const picked = await pickWorkspace(pb);
        updateConfig({ workspaceId: picked.id, workspaceName: picked.name });
        success(`Active workspace: ${picked.name} (${picked.id})`);
      } catch (err) {
        handleError(err);
      }
    });

  withJsonOption(
    ws
      .command('export [dir]')
      .description(
        'Export the workspace (media, clips, labels, timelines) as a ' +
          'directory of JSON files for AI agents (default dir: ./vw-export)'
      )
      .option('-w, --workspace <id>', 'workspace id override')
      .option('--no-labels', 'skip per-media label data')
      .option(
        '--force',
        'write into a non-empty directory that is not a previous export'
      )
  ).action(async (dir: string | undefined, opts) => {
    try {
      const pb = await requireClient();
      const workspaceId = await resolveWorkspaceId(pb, opts.workspace);
      const result = await exportWorkspace(
        pb,
        {
          workspaceId,
          dir: dir ?? 'vw-export',
          labels: opts.labels,
          force: opts.force,
        },
        opts.json ? undefined : info
      );
      if (opts.json) {
        printRecord(result, [], true);
        return;
      }
      const { counts } = result;
      success(
        `Exported workspace "${result.workspace.name}" to ${result.dir} ` +
          `(${counts.media} media, ${counts.mediaClips} clips, ` +
          `${counts.labels} labels, ${counts.timelines} timelines)`
      );
      info(`Agents should start at ${join(result.dir, 'INSTRUCTIONS.md')}`);
    } catch (err) {
      handleError(err);
    }
  });
}
