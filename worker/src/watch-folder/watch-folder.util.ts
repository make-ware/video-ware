import { DIRECTORY_NAME_MAX, DIRECTORY_NAME_PATTERN } from '@project/shared';
import type { StorageFile } from '@project/shared/storage';

/**
 * Pure planning logic for the S3 watch-folder importer. Everything here is
 * side-effect free so the tick-classification rules are unit-testable
 * without Nest, PocketBase, or S3.
 *
 * Import-area layout (single depth below the workspace segment):
 *   {prefix}{workspaceId}/{file}
 *   {prefix}{workspaceId}/{subdir}/{file}   subdir -> Directory
 *
 * Skip taxonomy follows one principle — burn (write a `skipped` ledger row,
 * never reconsider) iff the object can never become importable without the
 * object itself changing. A structural reject (root-level file, too-deep
 * nesting, unsupported extension, unsanitizable directory name) can only be
 * fixed by moving/renaming the object, which mints a new key and therefore a
 * fresh (key, etag) pair. An unknown workspace, by contrast, may simply not
 * exist YET — those files are left untouched and unburned (see the service).
 */

/**
 * Extensions the ingest pipeline understands (mediaType detection in
 * IngestOrchestratorService defaults unknown extensions to VIDEO, which would
 * turn stray .txt drops into broken placeholder Media — so the watcher
 * allowlists instead). NOTE: extending this list later does NOT revive
 * already-burned files; re-upload or rename them for a fresh attempt.
 */
export const WATCH_FOLDER_ALLOWED_EXTENSIONS = new Set([
  // video
  'mp4',
  'mov',
  'mkv',
  'avi',
  'webm',
  'm4v',
  'mts',
  'm2ts',
  'mpg',
  'mpeg',
  'wmv',
  'flv',
  '3gp',
  // audio
  'mp3',
  'wav',
  'm4a',
  'aac',
  'ogg',
  'flac',
  // image
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
]);

/** A file cleared for import (workspace existence still unverified). */
export interface ImportCandidate {
  key: string;
  etag: string;
  size: number;
  /** Workspace path segment (unvalidated record id). */
  workspaceId: string;
  /** Sanitized Directory name, or null for files at the workspace root. */
  directoryName: string | null;
  /** Original filename (last key segment); becomes Upload.name. */
  basename: string;
  /** Lowercased extension, without the dot. */
  extension: string;
}

/** Rejects that burn the (key, etag) pair in the ledger. */
export type BurnReason =
  | 'root-file'
  | 'too-deep'
  | 'bad-layout'
  | 'unsupported-extension'
  | 'bad-directory-name';

/** Rejects that are re-evaluated every tick and never recorded. */
export type SilentReason = 'placeholder' | 'hidden' | 'not-quiet';

export interface BurnSkip {
  key: string;
  etag: string;
  size: number;
  /** Workspace segment when the layout got far enough to have one. */
  workspaceId: string | null;
  reason: BurnReason;
  /** Operator-facing message stored on the ledger row. */
  detail: string;
}

export interface SilentSkip {
  key: string;
  reason: SilentReason;
}

export interface TickPlan {
  candidates: ImportCandidate[];
  burnSkips: BurnSkip[];
  silentSkips: SilentSkip[];
}

export interface TickOptions {
  /** Watched prefix, with trailing slash (e.g. 'import/'). */
  prefix: string;
  /** Objects younger than this (by LastModified) are left alone. */
  quietPeriodMs: number;
  /** Clock injection for tests. */
  now: number;
}

/**
 * Sanitize a raw S3 folder name to the Directories name contract
 * (letters/digits/dash/underscore, starting alphanumeric, max 60). Runs of
 * invalid characters collapse to a single '-'. Returns null when nothing
 * path-safe remains.
 */
export function sanitizeDirectoryName(raw: string): string | null {
  let name = raw.trim().replace(/[^A-Za-z0-9_-]+/g, '-');
  name = name.replace(/^[-_]+/, '');
  name = name.slice(0, DIRECTORY_NAME_MAX);
  if (!name || !DIRECTORY_NAME_PATTERN.test(name)) return null;
  return name;
}

/** Lowercased extension without the dot, or null when there is none. */
export function extensionOf(basename: string): string | null {
  const dot = basename.lastIndexOf('.');
  if (dot <= 0 || dot === basename.length - 1) return null;
  return basename.slice(dot + 1).toLowerCase();
}

type ParsedKey =
  | {
      kind: 'parts';
      workspaceId: string;
      subdir: string | null;
      basename: string;
    }
  | { kind: 'silent'; reason: SilentReason }
  | { kind: 'burn'; reason: BurnReason; workspaceId: string | null };

/**
 * Classify a key's layout relative to the watched prefix. Content rules
 * (extension, directory-name sanitization, quiet period) live in planTick.
 */
export function parseImportKey(key: string, prefix: string): ParsedKey {
  if (!key.startsWith(prefix)) {
    // listFiles is prefix-scoped, so this is defensive only.
    return { kind: 'burn', reason: 'bad-layout', workspaceId: null };
  }
  // S3-console "folders" are zero-byte objects whose key ends with '/'.
  if (key.endsWith('/')) {
    return { kind: 'silent', reason: 'placeholder' };
  }

  const segments = key.slice(prefix.length).split('/');
  if (segments.some((segment) => segment === '')) {
    return { kind: 'burn', reason: 'bad-layout', workspaceId: null };
  }
  if (segments.length === 1) {
    // A file directly at the import root has no workspace to import into.
    return { kind: 'burn', reason: 'root-file', workspaceId: null };
  }
  if (segments.length > 3) {
    return { kind: 'burn', reason: 'too-deep', workspaceId: segments[0] };
  }

  const basename = segments[segments.length - 1];
  if (basename.startsWith('.')) {
    return { kind: 'silent', reason: 'hidden' };
  }

  return {
    kind: 'parts',
    workspaceId: segments[0],
    subdir: segments.length === 3 ? segments[1] : null,
    basename,
  };
}

const BURN_DETAILS: Record<BurnReason, (key: string) => string> = {
  'root-file': () =>
    'file sits at the import root; expected {prefix}{workspaceId}/[dir/]file',
  'too-deep': () =>
    'nested deeper than one directory below the workspace segment',
  'bad-layout': (key) => `key does not match the import layout: ${key}`,
  'unsupported-extension': (key) =>
    `unsupported extension '${extensionOf(key.split('/').pop() ?? '') ?? '(none)'}'`,
  'bad-directory-name': () => '', // composed inline (needs the raw subdir)
};

/**
 * Partition one listing into import candidates, ledger-burnable rejects, and
 * silent (re-evaluated next tick) skips. Workspace existence is IO and is
 * NOT checked here — the service validates candidates' workspaceId and
 * demotes burnSkips of unknown workspaces to unburned skips.
 */
export function planTick(files: StorageFile[], opts: TickOptions): TickPlan {
  const plan: TickPlan = { candidates: [], burnSkips: [], silentSkips: [] };

  for (const file of files) {
    const parsed = parseImportKey(file.key, opts.prefix);

    if (parsed.kind === 'silent') {
      plan.silentSkips.push({ key: file.key, reason: parsed.reason });
      continue;
    }

    // Never touch (or burn) an object inside its quiet period: give
    // uploaders time to notice a mistake and delete/replace the drop.
    if (opts.now - file.lastModified.getTime() < opts.quietPeriodMs) {
      plan.silentSkips.push({ key: file.key, reason: 'not-quiet' });
      continue;
    }

    if (parsed.kind === 'burn') {
      plan.burnSkips.push({
        key: file.key,
        etag: file.etag,
        size: file.size,
        workspaceId: parsed.workspaceId,
        reason: parsed.reason,
        detail: BURN_DETAILS[parsed.reason](file.key),
      });
      continue;
    }

    const extension = extensionOf(parsed.basename);
    if (!extension || !WATCH_FOLDER_ALLOWED_EXTENSIONS.has(extension)) {
      plan.burnSkips.push({
        key: file.key,
        etag: file.etag,
        size: file.size,
        workspaceId: parsed.workspaceId,
        reason: 'unsupported-extension',
        detail: BURN_DETAILS['unsupported-extension'](file.key),
      });
      continue;
    }

    let directoryName: string | null = null;
    if (parsed.subdir !== null) {
      directoryName = sanitizeDirectoryName(parsed.subdir);
      if (!directoryName) {
        plan.burnSkips.push({
          key: file.key,
          etag: file.etag,
          size: file.size,
          workspaceId: parsed.workspaceId,
          reason: 'bad-directory-name',
          detail: `directory name not sanitizable: ${parsed.subdir}`,
        });
        continue;
      }
    }

    plan.candidates.push({
      key: file.key,
      etag: file.etag,
      size: file.size,
      workspaceId: parsed.workspaceId,
      directoryName,
      basename: parsed.basename,
      extension,
    });
  }

  return plan;
}
