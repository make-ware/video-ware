import { describe, expect, it, vi } from 'vitest';
import {
  CaptionType,
  DEFAULT_CAPTION_STYLE,
  DEFAULT_TITLE_STYLE,
} from '@project/shared';
import { createCaption, deleteCaption, updateCaption } from '../lib/caption.js';
import { fakePb, listResult, type Stub } from './fake-pb.js';

const notFound = () => Object.assign(new Error('not found'), { status: 404 });

/** Captions collection stub that echoes created/updated data back with an id. */
function captionStubs(
  existing?: Record<string, unknown>,
  referencingClips: Record<string, unknown>[] = []
): Record<string, Stub> {
  return {
    Captions: {
      create: vi.fn(async (data: object) => ({ ...data, id: 'cap1' })),
      getOne: vi.fn(async () => {
        if (!existing) throw notFound();
        return existing;
      }),
      update: vi.fn(async (id: string, data: object) => ({
        ...existing,
        ...data,
        id,
      })),
      delete: vi.fn(async () => true),
    },
    TimelineClips: {
      getList: vi.fn(async () => listResult(referencingClips)),
    },
  };
}

describe('createCaption', () => {
  it('creates an ad-hoc caption with the caption default style', async () => {
    const stubs = captionStubs();
    const pb = fakePb(stubs);

    const created = await createCaption(pb, {
      workspaceId: 'ws1',
      text: 'Hello world',
    });

    expect(stubs.Captions.create).toHaveBeenCalledOnce();
    expect(stubs.Captions.create.mock.calls[0][0]).toMatchObject({
      WorkspaceRef: 'ws1',
      UserRef: 'user1',
      captionType: CaptionType.CAPTION,
      text: 'Hello world',
      duration: 5,
      style: DEFAULT_CAPTION_STYLE,
    });
    // no cues without --animate
    expect(stubs.Captions.create.mock.calls[0][0].cues).toBeUndefined();
    expect(created.id).toBe('cap1');
  });

  it('creates a title card and animates the text into cues', async () => {
    const stubs = captionStubs();
    const pb = fakePb(stubs);

    await createCaption(pb, {
      workspaceId: 'ws1',
      text: 'Chapter One\nThe Beginning',
      type: CaptionType.TITLE,
      duration: 4,
      animate: true,
    });

    const input = stubs.Captions.create.mock.calls[0][0];
    expect(input).toMatchObject({
      captionType: CaptionType.TITLE,
      duration: 4,
      style: DEFAULT_TITLE_STYLE,
    });
    expect(input.cues).toEqual([
      { text: 'Chapter One', start: 0, end: 2 },
      { text: 'The Beginning', start: 2, end: 4 },
    ]);
  });

  it('layers individual style flags over the type default', async () => {
    const stubs = captionStubs();
    const pb = fakePb(stubs);

    await createCaption(pb, {
      workspaceId: 'ws1',
      text: 'Big title',
      type: CaptionType.TITLE,
      fontSize: 120,
      color: '#FFCC00',
      position: 'top',
    });

    expect(stubs.Captions.create.mock.calls[0][0].style).toMatchObject({
      ...DEFAULT_TITLE_STYLE,
      fontSize: 120,
      color: '#FFCC00',
      position: 'top',
    });
  });

  it('applies a --style JSON base then overrides it with flags', async () => {
    const stubs = captionStubs();
    const pb = fakePb(stubs);

    await createCaption(pb, {
      workspaceId: 'ws1',
      text: 'Styled',
      style: { fontSize: 60, color: '#111111', align: 'left' },
      color: '#FF0000', // flag wins over the JSON base
    });

    const style = stubs.Captions.create.mock.calls[0][0].style;
    expect(style.fontSize).toBe(60);
    expect(style.align).toBe('left');
    expect(style.color).toBe('#FF0000');
  });

  it('requires non-empty text', async () => {
    const pb = fakePb(captionStubs());
    await expect(
      createCaption(pb, { workspaceId: 'ws1', text: '  ' })
    ).rejects.toThrow(/text is required/i);
  });

  it('rejects a non-positive duration', async () => {
    const pb = fakePb(captionStubs());
    await expect(
      createCaption(pb, { workspaceId: 'ws1', text: 'x', duration: 0 })
    ).rejects.toThrow(/greater than zero/i);
  });
});

describe('updateCaption', () => {
  const existing = {
    id: 'cap1',
    captionType: 'caption',
    text: 'Old text',
    duration: 5,
    style: { fontSize: 48, color: '#FFFFFF', position: 'bottom' },
  };

  it('patches only the fields passed, merging style flags onto the existing', async () => {
    const stubs = captionStubs(existing);
    const pb = fakePb(stubs);

    await updateCaption(pb, 'cap1', { text: 'New text', color: '#FF0000' });

    const patch = stubs.Captions.update.mock.calls[0][1];
    expect(patch).toEqual({
      text: 'New text',
      style: { fontSize: 48, color: '#FF0000', position: 'bottom' },
    });
    expect(patch.captionType).toBeUndefined();
    expect(patch.duration).toBeUndefined();
  });

  it('re-bases the style on the new type default when the type changes', async () => {
    const stubs = captionStubs(existing);
    const pb = fakePb(stubs);

    await updateCaption(pb, 'cap1', { type: CaptionType.TITLE });

    const patch = stubs.Captions.update.mock.calls[0][1];
    expect(patch.captionType).toBe(CaptionType.TITLE);
    expect(patch.style).toEqual(DEFAULT_TITLE_STYLE);
  });

  it('regenerates cues from text and duration with --animate', async () => {
    const stubs = captionStubs({
      ...existing,
      text: 'Line one\nLine two',
      duration: 4,
    });
    const pb = fakePb(stubs);

    await updateCaption(pb, 'cap1', { animate: true });

    expect(stubs.Captions.update.mock.calls[0][1].cues).toEqual([
      { text: 'Line one', start: 0, end: 2 },
      { text: 'Line two', start: 2, end: 4 },
    ]);
  });

  it('errors when no field flag is passed', async () => {
    const pb = fakePb(captionStubs(existing));
    await expect(updateCaption(pb, 'cap1', {})).rejects.toThrow(
      /nothing to update/i
    );
  });

  it('errors when the caption does not exist', async () => {
    const pb = fakePb(captionStubs(undefined));
    await expect(updateCaption(pb, 'nope', { text: 'x' })).rejects.toThrow(
      /not found/i
    );
  });
});

describe('deleteCaption', () => {
  it('deletes a caption that no timeline clip references', async () => {
    const stubs = captionStubs({ id: 'cap1' }, []);
    const pb = fakePb(stubs);

    const result = await deleteCaption(pb, 'cap1');

    expect(stubs.Captions.delete).toHaveBeenCalledWith('cap1');
    expect(result.referencingClipIds).toEqual([]);
  });

  it('refuses to delete a referenced caption without --force', async () => {
    const stubs = captionStubs({ id: 'cap1' }, [
      { id: 'clipA' },
      { id: 'clipB' },
    ]);
    const pb = fakePb(stubs);

    await expect(deleteCaption(pb, 'cap1')).rejects.toThrow(/--force/i);
    expect(stubs.Captions.delete).not.toHaveBeenCalled();
  });

  it('deletes a referenced caption with --force and reports the refs', async () => {
    const stubs = captionStubs({ id: 'cap1' }, [{ id: 'clipA' }]);
    const pb = fakePb(stubs);

    const result = await deleteCaption(pb, 'cap1', { force: true });

    expect(stubs.Captions.delete).toHaveBeenCalledWith('cap1');
    expect(result.referencingClipIds).toEqual(['clipA']);
  });
});
