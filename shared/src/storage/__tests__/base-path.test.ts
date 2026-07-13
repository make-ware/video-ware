import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveLocalStorageBasePath } from '../base-path';
import { LocalStorageBackend } from '../local-backend';

/**
 * Regression tests for the storage base-path resolver.
 *
 * The invariant under test: every process in the monorepo (webapp, worker,
 * root scripts) MUST resolve a relative basePath like "data" to the SAME
 * absolute directory, no matter which workspace directory it runs from.
 * A previous "first ancestor that already contains data/" heuristic diverged
 * per-process once stray webapp/data and worker/data dirs existed, so the
 * webapp wrote uploads where the worker couldn't find them.
 */
describe('resolveLocalStorageBasePath', () => {
  let root: string;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vw-base-path-'));
    // Simulated monorepo: yarn.lock at root, nested workspace dirs, and
    // stray data/ dirs that the OLD heuristic would have wrongly latched onto.
    fs.writeFileSync(path.join(root, 'yarn.lock'), '');
    fs.mkdirSync(path.join(root, 'webapp', 'data'), { recursive: true });
    fs.mkdirSync(path.join(root, 'worker', 'nested', 'deep'), {
      recursive: true,
    });
    fs.mkdirSync(path.join(root, 'worker', 'data'), { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('passes absolute paths through untouched (Docker WORKER_DATA_DIR)', () => {
    expect(resolveLocalStorageBasePath('/data/storage')).toBe('/data/storage');
    expect(
      resolveLocalStorageBasePath('/data/storage', path.join(root, 'webapp'))
    ).toBe('/data/storage');
  });

  it('resolves a relative path to the same directory from every workspace CWD', () => {
    const expected = path.join(root, 'data');
    const cwds = [
      root,
      path.join(root, 'webapp'),
      path.join(root, 'worker'),
      path.join(root, 'worker', 'nested', 'deep'),
    ];
    for (const cwd of cwds) {
      expect(resolveLocalStorageBasePath('data', cwd)).toBe(expected);
    }
  });

  it('is not distracted by stray data/ dirs inside workspaces', () => {
    // webapp/data exists on disk, but resolution must still anchor to root.
    expect(resolveLocalStorageBasePath('data', path.join(root, 'webapp'))).toBe(
      path.join(root, 'data')
    );
  });

  it('treats "./data" and "data" identically', () => {
    const cwd = path.join(root, 'worker');
    expect(resolveLocalStorageBasePath('./data', cwd)).toBe(
      resolveLocalStorageBasePath('data', cwd)
    );
  });

  it('recognizes a workspaces-declaring package.json as the root', () => {
    const wsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vw-ws-root-'));
    try {
      fs.writeFileSync(
        path.join(wsRoot, 'package.json'),
        JSON.stringify({ name: 'mono', workspaces: ['app'] })
      );
      fs.mkdirSync(path.join(wsRoot, 'app'), { recursive: true });
      expect(
        resolveLocalStorageBasePath('data', path.join(wsRoot, 'app'))
      ).toBe(path.join(wsRoot, 'data'));
    } finally {
      fs.rmSync(wsRoot, { recursive: true, force: true });
    }
  });

  it('walks past non-workspace package.json files (workspace-local ones)', () => {
    // worker/package.json exists (no "workspaces") — must not stop the walk.
    fs.writeFileSync(
      path.join(root, 'worker', 'package.json'),
      JSON.stringify({ name: 'worker' })
    );
    expect(resolveLocalStorageBasePath('data', path.join(root, 'worker'))).toBe(
      path.join(root, 'data')
    );
  });

  it('keeps walking past a malformed package.json', () => {
    fs.writeFileSync(path.join(root, 'webapp', 'package.json'), '{not json');
    expect(resolveLocalStorageBasePath('data', path.join(root, 'webapp'))).toBe(
      path.join(root, 'data')
    );
  });
});

describe('LocalStorageBackend path resolution', () => {
  it('exposes the same resolution via getResolvedBasePath()', () => {
    const backend = new LocalStorageBackend({ basePath: '/data/storage' });
    expect(backend.getResolvedBasePath()).toBe('/data/storage');
    expect(backend.getResolvedBasePath()).toBe(
      resolveLocalStorageBasePath('/data/storage')
    );
  });

  it('resolves storage keys under the base and rejects traversal', () => {
    const backend = new LocalStorageBackend({ basePath: '/data/storage' });
    expect(backend.resolvePath('uploads/ws/up/original.mov')).toBe(
      '/data/storage/uploads/ws/up/original.mov'
    );
    expect(() => backend.resolvePath('../etc/passwd')).toThrow(
      /Invalid storage path/
    );
    expect(() => backend.resolvePath('uploads/../../etc/passwd')).toThrow(
      /Invalid storage path/
    );
  });
});
