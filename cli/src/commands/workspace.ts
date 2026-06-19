import type { Command } from 'commander';
import { WorkspaceMutator } from '@project/shared';
import { handleError, requireClient } from '../lib/run.js';
import { loadConfig, updateConfig } from '../lib/config.js';
import { pickWorkspace } from '../lib/select.js';
import { success, table } from '../lib/output.js';

export function registerWorkspaceCommands(program: Command): void {
  const ws = program
    .command('workspace')
    .alias('ws')
    .description('Manage the active workspace');

  ws.command('list')
    .alias('ls')
    .description('List workspaces')
    .action(async () => {
      try {
        const pb = await requireClient();
        const result = await new WorkspaceMutator(pb).getList(1, 100);
        const active = loadConfig().workspaceId;
        table(result.items, [
          { header: ' ', value: (w) => (w.id === active ? '*' : '') },
          { header: 'ID', value: (w) => w.id },
          { header: 'NAME', value: (w) => w.name },
          { header: 'SLUG', value: (w) => w.slug ?? '' },
        ]);
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
}
