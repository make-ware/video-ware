import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertWritableOutPath,
  isExistingDirectory,
  resolveOutPath,
} from '../lib/out-path.js';

describe('resolveOutPath', () => {
  const never = () => false;
  const always = () => true;

  it('defaults to the working directory', () => {
    expect(resolveOutPath(undefined, 'f.jpg', '/cwd', never)).toBe(
      '/cwd/f.jpg'
    );
  });

  it('treats a relative path as a file under the working directory', () => {
    expect(resolveOutPath('out.jpg', 'f.jpg', '/cwd', never)).toBe(
      '/cwd/out.jpg'
    );
  });

  it('keeps an absolute file path', () => {
    expect(resolveOutPath('/abs/out.jpg', 'f.jpg', '/cwd', never)).toBe(
      '/abs/out.jpg'
    );
  });

  it('writes the default name into an existing directory', () => {
    expect(resolveOutPath('/tmp/frames', 'f.jpg', '/cwd', always)).toBe(
      '/tmp/frames/f.jpg'
    );
  });

  it('treats a trailing separator as a directory even if it does not exist', () => {
    expect(resolveOutPath('/tmp/frames/', 'f.jpg', '/cwd', never)).toBe(
      '/tmp/frames/f.jpg'
    );
  });
});

describe('isExistingDirectory', () => {
  it('is false for a missing path and for a file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vw-outpath-'));
    try {
      const file = join(dir, 'a.txt');
      await writeFile(file, 'x');
      expect(isExistingDirectory(dir)).toBe(true);
      expect(isExistingDirectory(file)).toBe(false);
      expect(isExistingDirectory(join(dir, 'nope'))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('assertWritableOutPath', () => {
  it('refuses a path whose directory does not exist', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vw-outpath-'));
    try {
      expect(() =>
        assertWritableOutPath(join(dir, 'missing', 'a.mp4'))
      ).toThrow(/Output directory does not exist/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('refuses an existing file unless forced', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vw-outpath-'));
    try {
      const file = join(dir, 'a.mp4');
      await writeFile(file, 'x');
      expect(() => assertWritableOutPath(file)).toThrow(/pass --force/);
      expect(() => assertWritableOutPath(file, true)).not.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('accepts a new file in an existing directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vw-outpath-'));
    try {
      expect(() => assertWritableOutPath(join(dir, 'new.mp4'))).not.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
