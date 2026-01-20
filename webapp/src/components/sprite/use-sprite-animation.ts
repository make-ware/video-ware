import { useState, useEffect } from 'react';

interface UseSpriteAnimationProps {
  start?: number;
  end?: number;
  fps: number;
  cols: number;
  rows: number;
  isHovering: boolean;
  totalDuration: number;
}

export function useSpriteAnimation({
  start = 0,
  end,
  fps,
  cols,
  rows,
  isHovering,
  totalDuration,
}: UseSpriteAnimationProps) {
  const maxFrames = cols * rows;
  const effectiveEnd = end ?? totalDuration;

  // Calculate frame range
  const startFrame = Math.min(Math.floor(start * fps), maxFrames - 1);
  const endFrame = Math.min(Math.floor(effectiveEnd * fps), maxFrames - 1);

  const [frameIndex, setFrameIndex] = useState(startFrame);
  const [prevStartFrame, setPrevStartFrame] = useState(startFrame);
  const [prevIsHovering, setPrevIsHovering] = useState(isHovering);

  // Sync frameIndex with startFrame or when hover state changes during render
  if (startFrame !== prevStartFrame || isHovering !== prevIsHovering) {
    setPrevStartFrame(startFrame);
    setPrevIsHovering(isHovering);
    if (!isHovering) {
      setFrameIndex(startFrame);
    }
  }

  useEffect(() => {
    if (isHovering && startFrame < endFrame) {
      const interval = 1000 / Math.max(fps, 5);
      const timerId = setInterval(() => {
        setFrameIndex((prev) => (prev >= endFrame ? startFrame : prev + 1));
      }, interval);
      return () => clearInterval(timerId);
    }
  }, [isHovering, startFrame, endFrame, fps]);

  return {
    frameIndex,
    startFrame,
    endFrame,
    fx: frameIndex % cols,
    fy: Math.floor(frameIndex / cols),
  };
}
