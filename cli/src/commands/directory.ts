import type { Command } from 'commander';
import type { Directory } from '@project/shared';
import { handleError, requireClient } from '../lib/run.js';
import { resolveWorkspaceId } from '../lib/select.js';
import { directoryPaths, listDirectories } from '../lib/directory.js';
import { withJsonOption } from '../lib/options.js';
import { printList, type Column } from '../lib/output.js';

export function registerDirectoryCommands(program: Command): void {
  const directory = program
    .command('directory')
    .alias('dir')
    .description(
      'Optional media folders (e.g. per shoot or location) — media without one sits at the workspace root'
    );

  withJsonOption(
    directory
      .command('list')
      .alias('ls')
      .description('List directories in the active workspace')
      .option('-w, --workspace <id>', 'workspace id override')
  ).action(async (opts) => {
    try {
      const pb = await requireClient();
      const workspaceId = await resolveWorkspaceId(pb, opts.workspace);
      const result = await listDirectories(pb, workspaceId);
      const paths = directoryPaths(result.items);

      const columns: Column<Directory>[] = [
        { header: 'ID', value: (d) => d.id },
        { header: 'NAME', value: (d) => d.name },
      ];
      // PATH only earns its column when something is actually nested
      if (result.items.some((d) => d.ParentDirectoryRef)) {
        columns.push({
          header: 'PATH',
          value: (d) => paths.get(d.id) ?? d.name,
        });
      }

      printList(result.items, columns, {
        json: opts.json,
        totalItems: result.totalItems,
        hint: 'vw media list --directory <name|id> filters media',
      });
    } catch (err) {
      handleError(err);
    }
  });
}
