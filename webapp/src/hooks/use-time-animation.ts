import { useState, useEffect, useRef } from 'react';

interface UseTimeAnimationProps {
  start: number;
  end: number;
  enabled?: boolean;
  loop?: boolean;
  speed?: number; // Playback speed multiplier (1 = normal, 2 = 2x, etc.)
  fps?: number; // Target frame rate for updates. If <= 10, uses setInterval. Otherwise uses requestAnimationFrame.
}

export function useTimeAnimation({
  start,
  end,
  enabled = true,
  loop = true,
  speed = 1,
  fps = 10,
}: UseTimeAnimationProps) {
  const [currentTime, setCurrentTime] = useState(start);
  const lastUpdateRef = useRef<number>(0);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const intervalRef = useRef<NodeJS.Timeout | undefined>(undefined);

  // Reset time when start/end changes or when disabled
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setCurrentTime(start);
    }, 0);
    return () => clearTimeout(timeoutId);
  }, [start, end, enabled]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const duration = end - start;
    if (duration <= 0) {
      return;
    }

    // Use setInterval for low frame rates (like 1 fps)
    if (fps !== undefined && fps <= 10) {
      const intervalMs = 1000 / fps;
      const timeStep = (intervalMs / 1000) * speed;

      const update = () => {
        setCurrentTime((prev) => {
          const next = prev + timeStep;
          if (next >= end) {
            if (loop) {
              return start;
            } else {
              return end;
            }
          }
          return next;
        });
      };

      intervalRef.current = setInterval(update, intervalMs);

      return () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
      };
    }

    // Use requestAnimationFrame for smooth animation (default behavior)
    const update = (timestamp: number) => {
      if (!lastUpdateRef.current) {
        lastUpdateRef.current = timestamp;
      }

      const delta = (timestamp - lastUpdateRef.current) / 1000; // Convert to seconds
      lastUpdateRef.current = timestamp;

      setCurrentTime((prev) => {
        const next = prev + delta * speed;
        if (next >= end) {
          if (loop) {
            return start;
          } else {
            return end;
          }
        }
        return next;
      });

      animationFrameRef.current = requestAnimationFrame(update);
    };

    animationFrameRef.current = requestAnimationFrame(update);
    lastUpdateRef.current = 0;

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [start, end, enabled, loop, speed, fps]);

  return currentTime;
}
