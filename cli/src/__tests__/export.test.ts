import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EXPORT_MANIFEST_FILE, exportWorkspace } from '../lib/export.js';
import { fakePb, listResult, type Stub } from './fake-pb.js';

const LABEL_COLLECTIONS = [
  'LabelObjects',
  'LabelShots',
  'LabelPerson',
  'LabelSpeech',
  'LabelFaces',
  'LabelSegments',
  'LabelText',
];

const media1 = {
  id: 'm1',
  WorkspaceRef: 'ws1',
  mediaType: 'video',
  duration: 30,
  width: 1920,
  height: 1080,
  label: 'Beach',
  expand: { UploadRef: { name: 'beach.mp4' } },
};
const media2 = {
  id: 'm2',
  WorkspaceRef: 'ws1',
  mediaType: 'audio',
  duration: 90,
  width: 0,
  height: 0,
};
const clip1 = {
  id: 'c1',
  WorkspaceRef: 'ws1',
  MediaRef: 'm1',
  type: 'user',
  start: 5,
  end: 12.5,
  duration: 7.5,
};
const speech1 = {
  id: 'ls1',
  WorkspaceRef: 'ws1',
  MediaRef: 'm1',
  transcript: 'hello there',
  start: 0,
  end: 2,
  confidence: 0.9,
};
const speech2 = {
  id: 'ls2',
  WorkspaceRef: 'ws1',
  MediaRef: 'm1',
  transcript: 'general kenobi',
  start: 2,
  end: 4,
  confidence: 0.8,
};
const timeline1 = {
  id: 't1',
  WorkspaceRef: 'ws1',
  name: 'Ep 1',
  duration: 5,
  version: 1,
};
const track1 = { id: 'tr1', TimelineRef: 't1', name: 'Main Track', layer: 0 };
const timelineClip1 = {
  id: 'tc1',
  TimelineRef: 't1',
  TimelineTrackRef: 'tr1',
  MediaRef: 'm1',
  order: 0,
  start: 2,
  end: 7,
  duration: 5,
};

/** Full collection stub set for one small workspace; tests tweak as needed. */
function makeCollections(): Record<string, Stub> {
  const collections: Record<string, Stub> = {
    Workspaces: {
      getOne: vi.fn(async () => ({ id: 'ws1', name: 'Test WS' })),
    },
    Media: { getList: vi.fn(async () => listResult([media1, media2])) },
    MediaClips: { getList: vi.fn(async () => listResult([clip1])) },
    Timelines: {
      getList: vi.fn(async () => listResult([timeline1])),
      getOne: vi.fn(async () => timeline1),
    },
    TimelineClips: { getList: vi.fn(async () => listResult([timelineClip1])) },
    TimelineTracks: { getList: vi.fn(async () => listResult([track1])) },
  };
  for (const name of LABEL_COLLECTIONS) {
    collections[name] = {
      getList: vi.fn(async () =>
        listResult(name === 'LabelSpeech' ? [speech1, speech2] : [])
      ),
    };
  }
  return collections;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function readJson(...segments: string[]): any {
  return JSON.parse(readFileSync(join(...segments), 'utf8'));
}

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vw-export-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('exportWorkspace', () => {
  it('writes the full directory tree with grouped clips and labels', async () => {
    const dir = join(tempDir(), 'export');
    const pb = fakePb(makeCollections());

    const result = await exportWorkspace(pb, { workspaceId: 'ws1', dir });

    expect(result.workspace).toEqual({ id: 'ws1', name: 'Test WS' });
    expect(result.counts).toEqual({
      media: 2,
      mediaClips: 1,
      labels: 2,
      timelines: 1,
    });
    expect(Number.isNaN(Date.parse(result.exportedAt))).toBe(false);

    const manifest = readJson(dir, EXPORT_MANIFEST_FILE);
    expect(manifest.counts).toEqual(result.counts);
    expect(manifest.includesLabels).toBe(true);
    expect(readJson(dir, 'workspace.json').id).toBe('ws1');

    // media index summarizes both media, with clip/label counts.
    const mediaIndex = readJson(dir, 'media', 'index.json');
    expect(mediaIndex.totalItems).toBe(2);
    expect(mediaIndex.items[0]).toMatchObject({
      id: 'm1',
      name: 'beach.mp4',
      label: 'Beach',
      clipCount: 1,
      labelCounts: { speech: 2 },
    });
    expect(mediaIndex.items[1]).toMatchObject({
      id: 'm2',
      name: 'm2',
      clipCount: 0,
      labelCounts: {},
    });

    // m1 gets its record, clips, and speech labels; m2 only its record.
    expect(readJson(dir, 'media', 'm1', 'media.json').id).toBe('m1');
    expect(readJson(dir, 'media', 'm1', 'clips.json')).toEqual({
      items: [clip1],
      totalItems: 1,
    });
    expect(readJson(dir, 'media', 'm1', 'labels', 'speech.json')).toEqual({
      items: [speech1, speech2],
      totalItems: 2,
    });
    expect(existsSync(join(dir, 'media', 'm1', 'labels', 'object.json'))).toBe(
      false
    );
    expect(existsSync(join(dir, 'media', 'm2', 'clips.json'))).toBe(false);
    expect(existsSync(join(dir, 'media', 'm2', 'labels'))).toBe(false);

    // timeline snapshot matches the `timeline show --json` overview shape.
    const overview = readJson(dir, 'timelines', 't1.json');
    expect(overview.timeline.id).toBe('t1');
    expect(overview.computedDuration).toBe(5);
    expect(overview.tracks).toHaveLength(1);
    expect(overview.tracks[0].layer).toBe(0);
    expect(overview.tracks[0].clips[0]).toMatchObject({
      timelineStart: 0,
      timelineEnd: 5,
      kind: 'media',
    });
    const timelineIndex = readJson(dir, 'timelines', 'index.json');
    expect(timelineIndex.items[0]).toMatchObject({
      id: 't1',
      name: 'Ep 1',
      duration: 5,
      trackCount: 1,
      clipCount: 1,
    });

    const instructions = readFileSync(join(dir, 'INSTRUCTIONS.md'), 'utf8');
    expect(instructions).toContain('Test WS');
    expect(instructions).toContain('ws1');
    expect(instructions).toContain('-m m1');
    expect(instructions).toContain('-t t1');
  });

  it('scopes every fetch to the workspace', async () => {
    const dir = join(tempDir(), 'export');
    const collections = makeCollections();
    const pb = fakePb(collections);

    await exportWorkspace(pb, { workspaceId: 'ws1', dir });

    for (const name of ['Media', 'MediaClips', 'Timelines', 'LabelSpeech']) {
      const options = collections[name].getList.mock.calls[0][2];
      expect(options.filter).toContain('WorkspaceRef = ');
      expect(options.filter).toContain('ws1');
    }
  });

  it('fetches every page of a paginated collection', async () => {
    const dir = join(tempDir(), 'export');
    const collections = makeCollections();
    const page = (items: unknown[], totalPages: number) => ({
      page: 1,
      perPage: 200,
      totalItems: 2,
      totalPages,
      items,
    });
    collections.Media.getList = vi
      .fn()
      .mockResolvedValueOnce(page([media1], 2))
      .mockResolvedValueOnce(page([media2], 2));
    const pb = fakePb(collections);

    const result = await exportWorkspace(pb, { workspaceId: 'ws1', dir });

    expect(collections.Media.getList).toHaveBeenCalledTimes(2);
    expect(collections.Media.getList.mock.calls[1][0]).toBe(2);
    expect(result.counts.media).toBe(2);
    expect(existsSync(join(dir, 'media', 'm2', 'media.json'))).toBe(true);
  });

  it('skips label collections entirely with labels: false', async () => {
    const dir = join(tempDir(), 'export');
    const collections = makeCollections();
    const pb = fakePb(collections);

    const result = await exportWorkspace(pb, {
      workspaceId: 'ws1',
      dir,
      labels: false,
    });

    expect(result.includesLabels).toBe(false);
    expect(result.counts.labels).toBe(0);
    for (const name of LABEL_COLLECTIONS) {
      expect(collections[name].getList).not.toHaveBeenCalled();
    }
    expect(existsSync(join(dir, 'media', 'm1', 'labels'))).toBe(false);
  });

  it('refreshes a previous export in place, dropping stale entries', async () => {
    const dir = join(tempDir(), 'export');
    mkdirSync(join(dir, 'media', 'deleted'), { recursive: true });
    writeFileSync(join(dir, EXPORT_MANIFEST_FILE), '{}');
    writeFileSync(join(dir, 'media', 'deleted', 'media.json'), '{}');
    writeFileSync(join(dir, 'notes.txt'), 'user file');
    const pb = fakePb(makeCollections());

    await exportWorkspace(pb, { workspaceId: 'ws1', dir });

    expect(existsSync(join(dir, 'media', 'deleted'))).toBe(false);
    expect(existsSync(join(dir, 'media', 'm1', 'media.json'))).toBe(true);
    expect(readFileSync(join(dir, 'notes.txt'), 'utf8')).toBe('user file');
  });

  it('refuses a non-empty directory that is not an export unless forced', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'notes.txt'), 'user file');
    const pb = fakePb(makeCollections());

    await expect(
      exportWorkspace(pb, { workspaceId: 'ws1', dir })
    ).rejects.toThrow(/--force/);

    await exportWorkspace(pb, { workspaceId: 'ws1', dir, force: true });
    expect(existsSync(join(dir, 'media', 'index.json'))).toBe(true);
    expect(readFileSync(join(dir, 'notes.txt'), 'utf8')).toBe('user file');
  });

  it('fails fast on an unknown workspace', async () => {
    const collections = makeCollections();
    collections.Workspaces.getOne = vi.fn(async () => {
      throw Object.assign(new Error('not found'), { status: 404 });
    });
    const pb = fakePb(collections);
    const dir = join(tempDir(), 'export');

    await expect(
      exportWorkspace(pb, { workspaceId: 'nope', dir })
    ).rejects.toThrow('Workspace not found: nope');
    expect(existsSync(dir)).toBe(false);
  });
});
