import { describe, it, expect, vi } from 'vitest';
import { useEffect, useState } from 'react';
import { render, act } from '@testing-library/react';
import { useClipEditor } from '../use-clip-editor';
import type { Media } from '@project/shared';

// Isolate the hook from PocketBase / react-query: we only care about how it
// binds to the <video> element, not where the src comes from.
vi.mock('@/hooks/use-video-source', () => ({
  useVideoSource: () => ({ src: 'blob:test-src', poster: '' }),
}));

const media = { id: 'm1', duration: 10 } as unknown as Media;

/**
 * Renders the hook and mounts the <video> on a *later* commit than the hook's
 * first render. This mirrors the real app, where the player lives inside the
 * dialog's portal and so mounts after `src` is already known. The regression
 * being guarded: listener setup keyed on `src` (rather than the actual node)
 * misses that late mount, and the timeline playhead never tracks the video.
 */
function Harness() {
  const editor = useClipEditor({ media, initialStart: 0, initialEnd: 10 });

  const [showVideo, setShowVideo] = useState(false);
  useEffect(() => {
    setShowVideo(true);
  }, []);

  return (
    <div>
      <span data-testid="time">{editor.currentVideoTime}</span>
      {showVideo ? (
        <video data-testid="video" ref={editor.registerVideo} />
      ) : null}
    </div>
  );
}

describe('useClipEditor playhead sync', () => {
  it('tracks the video position after the <video> mounts late (portal)', () => {
    const { getByTestId } = render(<Harness />);

    const video = getByTestId('video') as HTMLVideoElement;

    // Simulate the video advancing during playback / a scrub.
    Object.defineProperty(video, 'currentTime', {
      value: 4.2,
      configurable: true,
    });
    act(() => {
      video.dispatchEvent(new Event('timeupdate'));
    });
    expect(getByTestId('time').textContent).toBe('4.2');

    // A seek (e.g. dragging the timeline playhead) is reflected too.
    Object.defineProperty(video, 'currentTime', {
      value: 7.5,
      configurable: true,
    });
    act(() => {
      video.dispatchEvent(new Event('seeked'));
    });
    expect(getByTestId('time').textContent).toBe('7.5');
  });
});
