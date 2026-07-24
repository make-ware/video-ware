import { describe, expect, it } from 'vitest';
import type { StorageFile } from '@project/shared/storage';
import {
  extensionOf,
  parseImportKey,
  planTick,
  sanitizeDirectoryName,
} from './watch-folder.util';

const PREFIX = 'import/';
const NOW = Date.parse('2026-07-23T12:00:00Z');
const QUIET_MS = 15 * 60 * 1000;

/** A file whose quiet period has elapsed unless `ageMs` says otherwise. */
function file(key: string, ageMs = QUIET_MS, size = 1024): StorageFile {
  return {
    key,
    size,
    etag: `etag-${key}`,
    lastModified: new Date(NOW - ageMs),
  };
}

function plan(files: StorageFile[]) {
  return planTick(files, { prefix: PREFIX, quietPeriodMs: QUIET_MS, now: NOW });
}

describe('parseImportKey', () => {
  it('parses a workspace-root file', () => {
    expect(parseImportKey('import/ws1/clip.mp4', PREFIX)).toEqual({
      kind: 'parts',
      workspaceId: 'ws1',
      subdir: null,
      basename: 'clip.mp4',
    });
  });

  it('parses a one-level subdirectory file', () => {
    expect(parseImportKey('import/ws1/interviews/take1.mp4', PREFIX)).toEqual({
      kind: 'parts',
      workspaceId: 'ws1',
      subdir: 'interviews',
      basename: 'take1.mp4',
    });
  });

  it('burns a file at the import root (no workspace segment)', () => {
    expect(parseImportKey('import/clip.mp4', PREFIX)).toEqual({
      kind: 'burn',
      reason: 'root-file',
      workspaceId: null,
    });
  });

  it('burns nesting deeper than one directory', () => {
    expect(parseImportKey('import/ws1/a/b/clip.mp4', PREFIX)).toEqual({
      kind: 'burn',
      reason: 'too-deep',
      workspaceId: 'ws1',
    });
  });

  it('burns keys with empty segments', () => {
    expect(parseImportKey('import/ws1//clip.mp4', PREFIX)).toMatchObject({
      kind: 'burn',
      reason: 'bad-layout',
    });
  });

  it('silently skips S3 folder placeholders', () => {
    expect(parseImportKey('import/ws1/interviews/', PREFIX)).toEqual({
      kind: 'silent',
      reason: 'placeholder',
    });
  });

  it('silently skips hidden dotfiles', () => {
    expect(parseImportKey('import/ws1/.DS_Store', PREFIX)).toEqual({
      kind: 'silent',
      reason: 'hidden',
    });
  });
});

describe('sanitizeDirectoryName', () => {
  it('passes through already-valid names', () => {
    expect(sanitizeDirectoryName('My_Folder-2')).toBe('My_Folder-2');
  });

  it('collapses spaces and symbols to single dashes', () => {
    expect(sanitizeDirectoryName('My  Folder!! (final)')).toBe(
      'My-Folder-final-'
    );
  });

  it('strips leading dashes/underscores', () => {
    expect(sanitizeDirectoryName('--_temp')).toBe('temp');
  });

  it('caps at the directory name maximum', () => {
    expect(sanitizeDirectoryName('x'.repeat(100))).toHaveLength(60);
  });

  it('returns null when nothing path-safe remains', () => {
    expect(sanitizeDirectoryName('日本語')).toBeNull();
    expect(sanitizeDirectoryName('---')).toBeNull();
    expect(sanitizeDirectoryName('   ')).toBeNull();
  });
});

describe('extensionOf', () => {
  it('lowercases the extension', () => {
    expect(extensionOf('CLIP.MP4')).toBe('mp4');
  });

  it('returns null for no extension or trailing dot', () => {
    expect(extensionOf('README')).toBeNull();
    expect(extensionOf('clip.')).toBeNull();
    expect(extensionOf('.hidden')).toBeNull();
  });
});

describe('planTick', () => {
  it('produces candidates with sanitized directory names', () => {
    const result = plan([
      file('import/ws1/clip.mp4'),
      file('import/ws1/My Folder/take 1.mov'),
    ]);
    expect(result.burnSkips).toEqual([]);
    expect(result.candidates).toEqual([
      expect.objectContaining({
        key: 'import/ws1/clip.mp4',
        workspaceId: 'ws1',
        directoryName: null,
        basename: 'clip.mp4',
        extension: 'mp4',
      }),
      expect.objectContaining({
        key: 'import/ws1/My Folder/take 1.mov',
        directoryName: 'My-Folder',
        basename: 'take 1.mov',
        extension: 'mov',
      }),
    ]);
  });

  it('holds files inside the quiet period (boundary: exactly quiet is eligible)', () => {
    const result = plan([
      file('import/ws1/young.mp4', QUIET_MS - 1),
      file('import/ws1/exact.mp4', QUIET_MS),
    ]);
    expect(result.silentSkips).toEqual([
      { key: 'import/ws1/young.mp4', reason: 'not-quiet' },
    ]);
    expect(result.candidates.map((c) => c.key)).toEqual([
      'import/ws1/exact.mp4',
    ]);
  });

  it('does not burn structural rejects until they are quiet', () => {
    const result = plan([file('import/root-drop.mp4', QUIET_MS - 1)]);
    expect(result.burnSkips).toEqual([]);
    expect(result.silentSkips).toEqual([
      { key: 'import/root-drop.mp4', reason: 'not-quiet' },
    ]);
  });

  it('burns unsupported extensions with an operator-facing detail', () => {
    const result = plan([file('import/ws1/notes.txt')]);
    expect(result.candidates).toEqual([]);
    expect(result.burnSkips).toEqual([
      expect.objectContaining({
        key: 'import/ws1/notes.txt',
        workspaceId: 'ws1',
        reason: 'unsupported-extension',
        detail: expect.stringContaining('txt'),
      }),
    ]);
  });

  it('burns unsanitizable directory names, keeping the raw name in the detail', () => {
    const result = plan([file('import/ws1/日本語/clip.mp4')]);
    expect(result.burnSkips).toEqual([
      expect.objectContaining({
        reason: 'bad-directory-name',
        detail: expect.stringContaining('日本語'),
      }),
    ]);
  });

  it('partitions each reject to exactly one bucket', () => {
    const result = plan([
      file('import/ws1/clip.mp4'), // candidate
      file('import/loose.mp4'), // burn: root-file
      file('import/ws1/a/b/deep.mp4'), // burn: too-deep
      file('import/ws1/.DS_Store'), // silent: hidden
      file('import/ws1/folder/', QUIET_MS, 0), // silent: placeholder
      file('import/ws1/fresh.mp4', 1000), // silent: not-quiet
    ]);
    expect(result.candidates).toHaveLength(1);
    expect(result.burnSkips.map((s) => s.reason).sort()).toEqual([
      'root-file',
      'too-deep',
    ]);
    expect(result.silentSkips.map((s) => s.reason).sort()).toEqual([
      'hidden',
      'not-quiet',
      'placeholder',
    ]);
  });
});
