import { describe, it, expect } from 'vitest';
import { render, act } from '@testing-library/react';
import { useFineTune } from '../use-fine-tune';
import type { Segment } from '@/components/timeline/segment-editor';

let hook: ReturnType<typeof useFineTune>;

function Harness(props: {
  segments: Segment[];
  mediaDuration: number;
  isImage?: boolean;
}) {
  hook = useFineTune({
    initialSegments: props.segments,
    mediaDuration: props.mediaDuration,
    isImage: props.isImage,
  });
  return null;
}

const mount = (segments: Segment[], mediaDuration = 60, isImage?: boolean) =>
  render(
    <Harness
      segments={segments}
      mediaDuration={mediaDuration}
      isImage={isImage}
    />
  );

const segs = (...pairs: Array<[number, number]>): Segment[] =>
  pairs.map(([start, end]) => ({ start, end }));

describe('useFineTune', () => {
  it('normalizes the initial edit list (sorts, clamps)', () => {
    mount(segs([20, 30], [-1, 10]), 25);
    expect(hook.segments).toEqual(segs([0, 10], [20, 25]));
    expect(hook.hasChanges).toBe(false);
  });

  it('splits at a source time and records history', () => {
    mount(segs([0, 30]));
    act(() => {
      hook.split(12);
    });
    expect(hook.segments).toEqual(segs([0, 12], [12, 30]));
    expect(hook.hasChanges).toBe(true);
    expect(hook.canUndo).toBe(true);
    expect(hook.times.duration).toBe(30); // split never changes duration
  });

  it('surfaces op errors without changing segments or history', () => {
    mount(segs([0, 10], [20, 30]));
    let ok = true;
    act(() => {
      ok = hook.split(15); // in the gap
    });
    expect(ok).toBe(false);
    expect(hook.error).toMatch(/not inside any segment/i);
    expect(hook.segments).toEqual(segs([0, 10], [20, 30]));
    expect(hook.canUndo).toBe(false);
  });

  it('cuts a range, undoes, and redoes', () => {
    mount(segs([0, 30]));
    act(() => {
      hook.cut(10, 12);
    });
    expect(hook.segments).toEqual(segs([0, 10], [12, 30]));
    expect(hook.times.duration).toBe(28);

    act(() => {
      hook.undo();
    });
    expect(hook.segments).toEqual(segs([0, 30]));
    expect(hook.canRedo).toBe(true);
    expect(hook.hasChanges).toBe(false);

    act(() => {
      hook.redo();
    });
    expect(hook.segments).toEqual(segs([0, 10], [12, 30]));
  });

  it('truncates the redo branch when a new op follows an undo', () => {
    mount(segs([0, 30]));
    act(() => {
      hook.cut(10, 12);
    });
    act(() => {
      hook.undo();
    });
    act(() => {
      hook.split(20);
    });
    expect(hook.segments).toEqual(segs([0, 20], [20, 30]));
    expect(hook.canRedo).toBe(false);
  });

  it('trims a segment by index and clamps the selection when the list shrinks', () => {
    mount(segs([0, 10], [20, 30], [40, 50]));
    act(() => {
      hook.setSelectedIndex(2);
    });
    act(() => {
      hook.cut(15, 55); // removes segments 1 and 2
    });
    expect(hook.segments).toEqual(segs([0, 10]));
    expect(hook.selectedIndex).toBe(0);

    act(() => {
      hook.trim(0, { end: 8 });
    });
    expect(hook.segments).toEqual(segs([0, 8]));
  });

  it('removes a segment by index and records history', () => {
    mount(segs([0, 10], [20, 30], [40, 50]));
    let ok = false;
    act(() => {
      ok = hook.remove(1);
    });
    expect(ok).toBe(true);
    expect(hook.segments).toEqual(segs([0, 10], [40, 50]));
    expect(hook.canUndo).toBe(true);

    act(() => {
      hook.undo();
    });
    expect(hook.segments).toEqual(segs([0, 10], [20, 30], [40, 50]));
  });

  it('refuses to remove the only remaining segment', () => {
    mount(segs([0, 30]));
    let ok = true;
    act(() => {
      ok = hook.remove(0);
    });
    expect(ok).toBe(false);
    expect(hook.error).toMatch(/only remaining segment/i);
    expect(hook.segments).toEqual(segs([0, 30]));
    expect(hook.canUndo).toBe(false);
  });

  it('merges all segments into the spanning one (remove all cuts), undoably', () => {
    mount(segs([0, 10], [20, 30], [40, 50]));
    let ok = false;
    act(() => {
      ok = hook.mergeAll();
    });
    expect(ok).toBe(true);
    expect(hook.segments).toEqual(segs([0, 50]));
    expect(hook.canUndo).toBe(true);

    act(() => {
      hook.undo();
    });
    expect(hook.segments).toEqual(segs([0, 10], [20, 30], [40, 50]));
  });

  it('mergeAll errors when there are no cuts to remove', () => {
    mount(segs([0, 30]));
    let ok = true;
    act(() => {
      ok = hook.mergeAll();
    });
    expect(ok).toBe(false);
    expect(hook.error).toMatch(/no cuts to remove/i);
    expect(hook.segments).toEqual(segs([0, 30]));
    expect(hook.canUndo).toBe(false);
  });

  it('slips and reports the clamped delta', () => {
    mount(segs([2, 5]), 60);
    let applied: number | null = null;
    act(() => {
      applied = hook.slip(-3.5, null);
    });
    expect(applied).toBe(-2);
    expect(hook.segments).toEqual(segs([0, 3]));
  });

  it('returns null and records no history for a fully clamped slip', () => {
    mount(segs([0, 5]));
    let applied: number | null = 0;
    act(() => {
      applied = hook.slip(-2, null);
    });
    expect(applied).toBeNull();
    expect(hook.error).toMatch(/nothing to slip/i);
    expect(hook.segments).toEqual(segs([0, 5]));
    expect(hook.canUndo).toBe(false);
  });

  it('resets to the initial list and clears history', () => {
    mount(segs([0, 30]));
    act(() => {
      hook.cut(10, 12);
    });
    act(() => {
      hook.split(5);
    });
    act(() => {
      hook.reset();
    });
    expect(hook.segments).toEqual(segs([0, 30]));
    expect(hook.hasChanges).toBe(false);
    expect(hook.canUndo).toBe(false);
    expect(hook.canRedo).toBe(false);
  });

  it('reports initial vs current derived times', () => {
    mount(segs([0, 30]));
    act(() => {
      hook.cut(10, 12);
    });
    expect(hook.initialTimes).toEqual({ start: 0, end: 30, duration: 30 });
    expect(hook.times).toEqual({ start: 0, end: 30, duration: 28 });
  });

  it('applies no upper bound for image media', () => {
    mount(segs([0, 5]), 0, true);
    let ok = false;
    act(() => {
      ok = hook.trim(0, { end: 500 });
    });
    expect(ok).toBe(true);
    expect(hook.segments).toEqual(segs([0, 500]));
  });
});
