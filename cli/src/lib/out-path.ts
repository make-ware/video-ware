import { existsSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';

/**
 * Where a command's byte output lands.
 *
 * Every `vw` command that writes bytes to the local filesystem (`vw frame`,
 * `vw media download`) shares these `-o/--out` semantics, so they live here
 * once rather than per command: the path names the output file unless it names
 * an existing directory, in which case the command's own default name is used
 * inside it.
 */

/** Whether a path exists and is a directory (the real `isDirectory`). */
export function isExistingDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Resolve `--out` to an absolute file path. A trailing separator means
 * "directory" even when the directory does not exist yet, so a typo'd
 * `-o out/` fails as a missing directory rather than silently writing a file
 * called `out`.
 *
 * `isDirectory` is injected so this stays pure and testable; real callers pass
 * `isExistingDirectory`.
 */
export function resolveOutPath(
  out: string | undefined,
  defaultName: string,
  cwd: string,
  isDirectory: (path: string) => boolean
): string {
  if (!out) return join(cwd, defaultName);
  const absolute = isAbsolute(out) ? out : resolve(cwd, out);
  if (out.endsWith(sep) || out.endsWith('/') || isDirectory(absolute)) {
    return join(absolute, defaultName);
  }
  return absolute;
}

/**
 * Refuse to write before any bytes are fetched. The parent directory must
 * already exist — a path into a directory that isn't there is a typo, not a
 * request to `mkdir -p` — and an existing file is only replaced under
 * `--force`.
 */
export function assertWritableOutPath(path: string, force?: boolean): void {
  const dir = dirname(path);
  if (!isExistingDirectory(dir)) {
    throw new Error(`Output directory does not exist: ${dir}`);
  }
  if (existsSync(path) && !force) {
    throw new Error(`Refusing to overwrite ${path} — pass --force.`);
  }
}
