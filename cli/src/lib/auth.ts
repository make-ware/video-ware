import { input, password as passwordPrompt } from '@inquirer/prompts';
import { clearAuth, loadConfig, updateConfig } from './config.js';
import { createClient, resolveUrl } from './pocketbase.js';
import { success } from './output.js';

export interface LoginOptions {
  url?: string;
  email?: string;
  password?: string;
}

/**
 * Authenticate against the Users collection and cache the token. Prompts for
 * any value not supplied via flags.
 */
export async function login(opts: LoginOptions): Promise<void> {
  const url =
    opts.url ??
    (await input({ message: 'PocketBase URL:', default: resolveUrl() }));
  const email =
    opts.email ??
    (await input({ message: 'Email:', default: loadConfig().userEmail }));
  const password =
    opts.password ??
    (await passwordPrompt({ message: 'Password:', mask: true }));

  const pb = createClient(url);
  const authData = await pb
    .collection('Users')
    .authWithPassword(email, password);

  updateConfig({
    url,
    token: pb.authStore.token,
    userId: authData.record.id,
    userEmail: authData.record.email ?? email,
  });

  success(`Logged in as ${authData.record.email ?? email}`);
}

export function logout(): void {
  clearAuth();
  success('Logged out.');
}
