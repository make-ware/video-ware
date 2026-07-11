import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ClipFineTuneModal } from '../clip-fine-tune-modal';
import type { Media } from '@project/shared';

vi.mock('@/hooks/use-video-source', () => ({
  useVideoSource: () => ({ src: 'blob:test-src', poster: '' }),
}));

const media = {
  id: 'm1',
  duration: 60,
  mediaType: 'video',
} as unknown as Media;

function renderModal(onApply = vi.fn(), onOpenChange = vi.fn()) {
  render(
    <ClipFineTuneModal
      open
      onOpenChange={onOpenChange}
      media={media}
      initialSegments={[{ start: 0, end: 30 }]}
      onApply={onApply}
    />
  );
  return { onApply, onOpenChange };
}

/** Seek the modal's <video> so playhead-based ops act at `time`. */
function seekVideo(time: number) {
  const video = document.querySelector('video') as HTMLVideoElement;
  Object.defineProperty(video, 'currentTime', {
    value: time,
    configurable: true,
    writable: true,
  });
  act(() => {
    video.dispatchEvent(new Event('seeked'));
  });
}

describe('ClipFineTuneModal', () => {
  it('cuts a marked range and applies the result', () => {
    const { onApply, onOpenChange } = renderModal();

    expect(screen.getByText('Fine-tune Segments')).toBeInTheDocument();
    const apply = screen.getByRole('button', { name: /apply changes/i });
    expect(apply).toBeDisabled();

    // Mark 10–12 from the playhead, then cut the range
    seekVideo(10);
    fireEvent.click(screen.getByRole('button', { name: /mark in/i }));
    seekVideo(12);
    fireEvent.click(screen.getByRole('button', { name: /mark out/i }));
    fireEvent.click(screen.getByRole('button', { name: /cut marked range/i }));

    expect(screen.getByText(/2 segments/)).toBeInTheDocument();
    expect(apply).toBeEnabled();

    fireEvent.click(apply);
    expect(onApply).toHaveBeenCalledWith([
      { start: 0, end: 10 },
      { start: 12, end: 30 },
    ]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('surfaces op errors inline without changing segments', () => {
    renderModal();

    // Playhead at 0 sits on a segment boundary — split must fail visibly
    fireEvent.click(screen.getByRole('button', { name: /split at playhead/i }));

    expect(screen.getByText(/not inside any segment/i)).toBeInTheDocument();
    expect(screen.getByText(/1 segment\b/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /apply changes/i })
    ).toBeDisabled();
  });

  it('splits at the playhead and undoes', () => {
    renderModal();

    seekVideo(15);
    fireEvent.click(screen.getByRole('button', { name: /split at playhead/i }));
    expect(screen.getByText(/2 segments/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /undo/i }));
    expect(screen.getByText(/1 segment\b/)).toBeInTheDocument();
  });
});
