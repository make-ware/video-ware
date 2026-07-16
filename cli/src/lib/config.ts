import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

/**
 * Persisted CLI state. Lives at ~/.config/video-ware/config.json.
 * `token`/`userId`/`userEmail` are written by `vw login`; `workspaceId`/
 * `workspaceName` by `vw workspace use`; `appUrl` by `vw login --app-url`
 * (only needed when the webapp origin differs from the PocketBase URL,
 * e.g. split-origin local dev).
 */
export interface CliConfig {
  url?: string;
  appUrl?: string;
  token?: string;
  userId?: string;
  userEmail?: string;
  workspaceId?: string;
  workspaceName?: string;
}

export const CONFIG_PATH = join(
  homedir(),
  '.config',
  'video-ware',
  'config.json'
);

export function loadConfig(): CliConfig {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as CliConfig;
  } catch {
    // A corrupt config should not crash the CLI — treat it as empty.
    return {};
  }
}

export function saveConfig(config: CliConfig): void {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  // 0o600 — the file holds an auth token.
  writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
  });
}

export function updateConfig(patch: Partial<CliConfig>): CliConfig {
  const next = { ...loadConfig(), ...patch };
  saveConfig(next);
  return next;
}

/** Remove auth fields, keeping url/workspace selection. */
export function clearAuth(): void {
  const cfg = loadConfig();
  delete cfg.token;
  delete cfg.userId;
  delete cfg.userEmail;
  saveConfig(cfg);
}
