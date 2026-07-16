import type { Command } from 'commander';
import { login, logout } from '../lib/auth.js';
import { handleError } from '../lib/run.js';

export function registerAuthCommands(program: Command): void {
  program
    .command('login')
    .description('Authenticate with PocketBase and cache the session')
    .option('--url <url>', 'PocketBase URL')
    .option(
      '--app-url <url>',
      'webapp origin serving /api-next, for uploads (only when it differs from the PocketBase URL)'
    )
    .option('--email <email>', 'account email')
    .option('--password <password>', 'account password')
    .action(async (opts) => {
      try {
        await login(opts);
      } catch (err) {
        handleError(err);
      }
    });

  program
    .command('logout')
    .description('Clear the cached session')
    .action(() => logout());
}
