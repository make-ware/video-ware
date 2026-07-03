import { Command } from 'commander';
import { registerAuthCommands } from './commands/login.js';
import { registerWorkspaceCommands } from './commands/workspace.js';
import { registerMediaCommands } from './commands/media.js';
import { registerLabelCommands } from './commands/label.js';
import { registerTimelineCommands } from './commands/timeline.js';

const program = new Command();

program
  .name('vw')
  .description(
    'video-ware CLI — log in, choose a workspace, list media, build and render timelines'
  )
  .version('0.0.0');

registerAuthCommands(program);
registerWorkspaceCommands(program);
registerMediaCommands(program);
registerLabelCommands(program);
registerTimelineCommands(program);

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
