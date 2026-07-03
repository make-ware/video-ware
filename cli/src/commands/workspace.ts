import { join } from 'node:path';
import type { Command } from 'commander';
import { WorkspaceMutator } from '@project/shared';
import { handleError, requireClient } from '../lib/run.js';
import { loadConfig, updateConfig } from '../lib/config.js';
import { pickWorkspace, resolveWorkspaceId } from '../lib/select.js';
import { withJsonOption } from '../lib/options.js';
import { info, printList, printRecord, success } from '../lib/output.js';
import { exportWorkspace } from '../lib/export.js';

export function registerWorkspaceCommands(program: Command): void {
  const ws = program
    .command('workspace')
    .alias('ws')
    .description('Manage the active workspace');

  withJsonOption(
    ws.command('list').alias('ls').description('List workspaces')
  ).action(async (opts) => {
    try {
      const pb = await requireClient();
      const result = await new WorkspaceMutator(pb).getList(1, 100);
      const active = loadConfig().workspaceId;
      printList(
        result.items,
        [
          { header: ' ', value: (w) => (w.id === active ? '*' : '') },
          { header: 'ID', value: (w) => w.id },
          { header: 'NAME', value: (w) => w.name },
          { header: 'SLUG', value: (w) => w.slug ?? '' },
        ],
        { json: opts.json, totalItems: result.totalItems }
      );
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
