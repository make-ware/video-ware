import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { registerAuthCommands } from './commands/login.js';
import { registerWorkspaceCommands } from './commands/workspace.js';
import { registerMediaCommands } from './commands/media.js';
import { registerLabelCommands } from './commands/label.js';
import { registerTimelineCommands } from './commands/timeline.js';

/**
 * The CLI version is the repo version from the root package.json — the single
 * version release-please bumps (tags are `video-ware-v*`); the CLI workspace
 * is not independently versioned. Resolved relative to this module so it works
 * both from `dist/` (built) and `src/` (tsx dev): both sit two levels below the
 * repo root. Falls back to 0.0.0 if the file can't be read.
 */
function resolveVersion(): string {
  try {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const pkg = JSON.parse(
      readFileSync(join(root, 'package.json'), 'utf8')
    ) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const program = new Command();

program
  .name('vw')
  .description(
    'video-ware CLI — log in, choose a workspace, list media, build and render timelines'
  )
  .version(resolveVersion());

registerAuthCommands(program);
registerWorkspaceCommands(program);
registerMediaCommands(program);
registerLabelCommands(program);
registerTimelineCommands(program);

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
