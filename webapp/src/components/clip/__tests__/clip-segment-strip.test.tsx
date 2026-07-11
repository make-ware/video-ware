import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ClipSegmentStrip } from '../clip-segment-strip';
import type { Segment } from '@/components/timeline/segment-editor';

const segs = (...pairs: Array<[number, number]>): Segment[] =>
  pairs.map(([start, end]) => ({ start, end }));

type Props = React.ComponentProps<typeof ClipSegmentStrip>;

function setup(overrides: Partial<Props> = {}) {
  const handlers = {
    onSelect: vi.fn(),
    onScrub: vi.fn(),
    onMove: vi.fn(),
    onTrim: vi.fn(),
    onDelete: vi.fn(),
  };
  const utils = render(
    <ClipSegmentStrip
      segments={segs([0, 10], [20, 30])}
      displayRange={{ from: 0, to: 60 }}
      selectedIndex={null}
      currentTime={0}
      markIn={null}
      markOut={null}
      mediaDuration={60}
      {...handlers}
      {...overrides}
    />
  );
  const strip = utils.container.firstElementChild as HTMLElement;
  const segments = Array.from(
    strip.querySelectorAll<HTMLElement>('[title^="Segment"]')
  );
  return { ...utils, ...handlers, strip, segments };
}

// The strip maps clientX → time via getBoundingClientRect; a 200px-wide strip
// over a 0–60s window means 1px = 0.3s (clientX 15 → 4.5s, 45 → 13.5s).
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    right: 200,
    bottom: 56,
    width: 200,
    height: 56,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ClipSegmentStrip', () => {
  it('selects the segment and seeks on a tap (no drag)', () => {
    const { strip, segments, onSelect, onScrub, onMove } = setup();
    fireEvent.pointerDown(segments[0], { clientX: 15, pointerId: 1 });
    expect(onSelect).toHaveBeenCalledWith(0);
    fireEvent.pointerUp(strip, { clientX: 15, pointerId: 1 });
    expect(onScrub).toHaveBeenCalledWith(4.5);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('slips a segment when its body is dragged', () => {
    const { strip, segments, onMove } = setup();
    fireEvent.pointerDown(segments[0], { clientX: 15, pointerId: 1 });
    fireEvent.pointerMove(strip, { clientX: 45, pointerId: 1 });
    fireEvent.pointerUp(strip, { clientX: 45, pointerId: 1 });
    // dragged +9s; clamped only by the neighbor at 20s (seg0 → 9–19)
    expect(onMove).toHaveBeenCalledWith(0, 9);
  });

  it('trims the start edge when the left handle is dragged', () => {
    const { strip, segments, onTrim } = setup();
    const leftHandle = segments[0].children[0] as HTMLElement;
    fireEvent.pointerDown(leftHandle, { clientX: 15, pointerId: 1 });
    fireEvent.pointerMove(strip, { clientX: 30, pointerId: 1 });
    fireEvent.pointerUp(strip, { clientX: 30, pointerId: 1 });
    expect(onTrim).toHaveBeenCalledWith(0, 'start', 9);
  });

  it('scrubs and clears the selection when the empty strip is pressed', () => {
    const { strip, onScrub, onSelect } = setup();
    fireEvent.pointerDown(strip, { clientX: 50, pointerId: 1 });
    expect(onSelect).toHaveBeenCalledWith(null);
    expect(onScrub).toHaveBeenCalledWith(15);
  });

  it('deletes a segment via its delete button', () => {
    const { getByLabelText, onDelete } = setup({ selectedIndex: 1 });
    fireEvent.click(getByLabelText('Delete segment 1'));
    expect(onDelete).toHaveBeenCalledWith(1);
  });
});
