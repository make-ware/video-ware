import { render, fireEvent, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LayerTimelineView } from '../layer-timeline-view';

// Touch behaviour of the lane surface. happy-dom has no gesture engine and no
// layout, so these drive the raw touch events the component listens for and
// assert on the state they are allowed to change. Actual panning inertia and
// pinch behaviour are manual QA.

const setCurrentTime = vi.fn();
const clearClipSelection = vi.fn();
const setSelectedTrackId = vi.fn();

const TRACK = {
  id: 'track-1',
  TimelineRef: 'tl-1',
  name: 'Layer 0',
  layer: 0,
  isMuted: false,
  isLocked: false,
  volume: 1,
  opacity: 1,
};

const timeline = {
  id: 'tl-1',
  name: 'Test',
  WorkspaceRef: 'ws-1',
  duration: 60,
  clips: [],
  tracks: [TRACK],
};

vi.mock('@/hooks/use-timeline', () => ({
  useTimeline: () => ({
    timeline,
    currentTime: 0,
    setCurrentTime,
    duration: 60,
    isPlaying: false,
    selectedClipIds: new Set<string>(),
    selectAllClips: vi.fn(),
    clearClipSelection,
    handleClipSelect: vi.fn(),
    removeSelectedClips: vi.fn(),
    selectedTrackId: null,
    setSelectedTrackId,
    updateClipTimes: vi.fn(),
    createTrack: vi.fn(),
    updateTrack: vi.fn(),
    deleteTrack: vi.fn(),
    applyClipDrop: vi.fn(),
    addClip: vi.fn(),
    refreshTimeline: vi.fn(),
  }),
}));

vi.mock('@/lib/pocketbase-client', () => ({
  default: { files: { getURL: () => '' }, collection: () => ({}) },
}));

/** The lane surface: the element carrying the touch handlers under test. */
function trackArea(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('[style*="ew-resize"]');
  if (!el) throw new Error('track area not found');
  return el;
}

function ruler(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('[data-scrub-zone]');
  if (!el) throw new Error('scrub zone not found');
  return el;
}

function touch(x: number, y = 40) {
  return { clientX: x, clientY: y };
}

describe('LayerTimelineView touch handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not scrub while a finger pans the lanes', () => {
    const { container } = render(<LayerTimelineView />);

    fireEvent.touchStart(trackArea(container), { touches: [touch(120)] });
    // A pan: the window-level scrub listener must not be running, so a move
    // cannot move the playhead.
    act(() => {
      window.dispatchEvent(
        Object.assign(new Event('touchmove', { bubbles: true }), {
          touches: [touch(220)],
        })
      );
    });

    expect(setCurrentTime).not.toHaveBeenCalled();
    // Pressing a lane still selects it as the insertion target.
    expect(clearClipSelection).toHaveBeenCalled();
  });

  it('treats a touch that barely travelled as a tap and positions the playhead', () => {
    const { container } = render(<LayerTimelineView />);
    const area = trackArea(container);

    fireEvent.touchStart(area, { touches: [touch(120)] });
    fireEvent.touchEnd(area, { changedTouches: [touch(123)] });

    expect(setCurrentTime).toHaveBeenCalledTimes(1);
  });

  it('ignores a touch that travelled — that was a pan, not a tap', () => {
    const { container } = render(<LayerTimelineView />);
    const area = trackArea(container);

    fireEvent.touchStart(area, { touches: [touch(120)] });
    fireEvent.touchEnd(area, { changedTouches: [touch(260)] });

    expect(setCurrentTime).not.toHaveBeenCalled();
  });

  it('scrubs continuously from the ruler', () => {
    const { container } = render(<LayerTimelineView />);

    fireEvent.touchStart(ruler(container), { touches: [touch(120)] });
    expect(setCurrentTime).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(
        Object.assign(new Event('touchmove', { bubbles: true }), {
          touches: [touch(220)],
        })
      );
    });
    expect(setCurrentTime).toHaveBeenCalledTimes(2);
  });

  it('stops scrubbing when the touch is cancelled', () => {
    const { container } = render(<LayerTimelineView />);

    fireEvent.touchStart(ruler(container), { touches: [touch(120)] });
    act(() => {
      window.dispatchEvent(new Event('touchcancel', { bubbles: true }));
    });

    const callsBefore = setCurrentTime.mock.calls.length;
    act(() => {
      window.dispatchEvent(
        Object.assign(new Event('touchmove', { bubbles: true }), {
          touches: [touch(300)],
        })
      );
    });
    // A latched scrub used to follow every later touch anywhere on the page.
    expect(setCurrentTime.mock.calls.length).toBe(callsBefore);
  });
});
