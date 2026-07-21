import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { TrimHandles } from '../trim-handles';

type Props = React.ComponentProps<typeof TrimHandles>;

// duration 100 with a 10–90 range: the default view window pads out to the
// full media, so a 200px-wide track maps 1px = 0.5s (clientX 100 → 50s).
function setup(overrides: Partial<Props> = {}) {
  const onChange = vi.fn();
  const onScrub = vi.fn();
  const utils = render(
    <TrimHandles
      duration={100}
      startTime={10}
      endTime={90}
      onChange={onChange}
      onScrub={onScrub}
      {...overrides}
    />
  );
  const range = utils.container.querySelector(
    '[class*="cursor-grab"]'
  ) as HTMLElement;
  return { ...utils, onChange, onScrub, range };
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    right: 200,
    bottom: 40,
    width: 200,
    height: 40,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TrimHandles range move', () => {
  it('shifts the whole range, preserving its duration', () => {
    const { range, onChange } = setup();
    fireEvent.mouseDown(range, { clientX: 100 }); // grab at 50s
    fireEvent.mouseMove(document, { clientX: 110 }); // +5s
    expect(onChange).toHaveBeenLastCalledWith(15, 95);
    fireEvent.mouseUp(document);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('clamps the shift at the media bounds', () => {
    const { range, onChange } = setup();
    fireEvent.mouseDown(range, { clientX: 100 });
    fireEvent.mouseMove(document, { clientX: 160 }); // +30s, only 10 left
    expect(onChange).toHaveBeenLastCalledWith(20, 100);
    fireEvent.mouseMove(document, { clientX: 60 }); // -20s from origin
    expect(onChange).toHaveBeenLastCalledWith(0, 80);
    fireEvent.mouseUp(document);
  });

  it('treats a press without movement as a playhead tap', async () => {
    const { range, onChange, onScrub } = setup();
    fireEvent.mouseDown(range, { clientX: 100 });
    fireEvent.mouseUp(document);
    await waitFor(() => expect(onScrub).toHaveBeenCalledWith(50, 'playhead'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('ignores movement below the drag threshold', async () => {
    const { range, onChange, onScrub } = setup();
    fireEvent.mouseDown(range, { clientX: 100 });
    fireEvent.mouseMove(document, { clientX: 101 }); // < 3px
    fireEvent.mouseUp(document);
    await waitFor(() => expect(onScrub).toHaveBeenCalledWith(50, 'playhead'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('leaves trim-handle dragging unchanged', () => {
    const { getByRole, onChange } = setup();
    const startHandle = getByRole('slider', { name: 'Trim start' });
    fireEvent.mouseDown(startHandle, { clientX: 20 });
    fireEvent.mouseMove(document, { clientX: 30 }); // → 15s
    expect(onChange).toHaveBeenLastCalledWith(15, 90);
    fireEvent.mouseUp(document);
  });

  it('does not start a move when disabled', () => {
    const { container, onChange } = setup({ disabled: true });
    // cursor-grab styling is off while disabled; grab the active region by
    // its border classes instead.
    const range = container.querySelector(
      '[class*="border-y-2"]'
    ) as HTMLElement;
    fireEvent.mouseDown(range, { clientX: 100 });
    fireEvent.mouseMove(document, { clientX: 120 });
    expect(onChange).not.toHaveBeenCalled();
  });
});
