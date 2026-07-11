import { describe, it, expect, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { useClipEditor } from '../use-clip-editor';
import type { Segment } from '@/components/timeline/segment-editor';
import type { Media } from '@project/shared';

vi.mock('@/hooks/use-video-source', () => ({
  useVideoSource: () => ({ src: 'blob:test-src', poster: '' }),
}));

const media = {
  id: 'm1',
  duration: 60,
  mediaType: 'video',
} as unknown as Media;

let hook: ReturnType<typeof useClipEditor>;

function Harness(props: {
  initialStart: number;
  initialEnd: number;
  initialSegments?: Segment[];
  isComposite?: boolean;
}) {
  hook = useClipEditor({
    media,
    initialStart: props.initialStart,
    initialEnd: props.initialEnd,
    initialSegments: props.initialSegments,
    isComposite: props.isComposite,
    minDuration: 0.5,
  });
  return null;
}

const segs = (...pairs: Array<[number, number]>): Segment[] =>
  pairs.map(([start, end]) => ({ start, end }));

const mountComposite = (segments: Segment[]) =>
  render(
    <Harness
      initialStart={Math.min(...segments.map((s) => s.start))}
      initialEnd={Math.max(...segments.map((s) => s.end))}
      initialSegments={segments}
      isComposite
    />
  );

describe('useClipEditor (composite trim window)', () => {
  it('passes the full edit list through when the window spans it', () => {
    mountComposite(segs([10, 20], [40, 50]));
    expect(hook.effectiveSegments).toEqual(segs([10, 20], [40, 50]));
    expect(hook.effectiveDuration).toBe(20);
    expect(hook.hasChanges).toBe(false);
    expect(hook.validationError).toBeNull();
  });

  it('clamps the edit list to a narrowed window without touching segments', () => {
    mountComposite(segs([10, 20], [40, 50]));
    act(() => hook.handleTrimChange(15, 45));

    expect(hook.segments).toEqual(segs([10, 20], [40, 50]));
    expect(hook.effectiveSegments).toEqual(segs([15, 20], [40, 45]));
    expect(hook.effectiveDuration).toBe(10);
    expect(hook.hasChanges).toBe(true);
    expect(hook.validationError).toBeNull();

    // dragging back out restores the full list — nothing was lost
    act(() => hook.handleTrimChange(10, 50));
    expect(hook.effectiveSegments).toEqual(segs([10, 20], [40, 50]));
    expect(hook.hasChanges).toBe(false);
  });

  it('drops segments that fall entirely outside the window', () => {
    mountComposite(segs([10, 20], [40, 50]));
    act(() => hook.handleTrimChange(35, 50));
    expect(hook.effectiveSegments).toEqual(segs([40, 50]));
    expect(hook.effectiveDuration).toBe(10);
  });

  it('rejects a window that covers no segment content', () => {
    mountComposite(segs([10, 20], [40, 50]));
    act(() => hook.handleTrimChange(25, 35));
    expect(hook.effectiveSegments).toEqual([]);
    expect(hook.effectiveDuration).toBe(0);
    expect(hook.validationError).toMatch(/no segment content/i);
    expect(hook.canSave).toBe(false);
  });

  it('validates the window bounds like a plain clip', () => {
    mountComposite(segs([10, 20], [40, 50]));
    act(() => hook.handleTrimChange(10, 70));
    expect(hook.validationError).toMatch(/exceed media duration/i);
  });

  it('enforces the minimum effective duration on the clamped list', () => {
    mountComposite(segs([10, 20], [40, 50]));
    act(() => hook.handleTrimChange(19.8, 40.1));
    // window keeps 0.2 + 0.1 of content — under the 0.5s minimum
    expect(hook.validationError).toMatch(/at least 0.5s/i);
  });

  it('applySegments replaces the list and re-spans the window', () => {
    mountComposite(segs([10, 20], [40, 50]));
    act(() => hook.handleTrimChange(15, 45));
    act(() => hook.applySegments(segs([5, 12], [30, 35])));

    expect(hook.segments).toEqual(segs([5, 12], [30, 35]));
    expect(hook.startTime).toBe(5);
    expect(hook.endTime).toBe(35);
    expect(hook.effectiveSegments).toEqual(segs([5, 12], [30, 35]));
    expect(hook.effectiveDuration).toBe(12);
    expect(hook.hasChanges).toBe(true);
  });
});
