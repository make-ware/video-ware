import { useMemo } from 'react';
import type { Media, MediaRelations, Expanded } from '@project/shared';
import pb from '@/lib/pocketbase-client';
import { cn } from '@/lib/utils';
import { useFilmstripData, FilmstripConfig } from './use-filmstrip-data';

interface FilmstripViewerProps<
  E extends keyof MediaRelations = 'filmstripFileRefs',
> {
  media: Media | Expanded<Media, MediaRelations, E>;
  currentTime: number;
  className?: string;
}

export function FilmstripViewer({
  media,
  currentTime,
  className,
}: FilmstripViewerProps) {
  const { getFilmstripForTime, isLoading } = useFilmstripData(media);

  // Memoize the active filmstrip calculation to avoid recalculating on every render if time hasn't changed enough
  // (Though currentTime changes frequently during playback)
  const activeData = useMemo(() => {
    const file = getFilmstripForTime(currentTime);
    if (!file || !file.meta?.filmstripConfig) return null;
    return {
      file,
      config: file.meta.filmstripConfig as FilmstripConfig,
    };
  }, [getFilmstripForTime, currentTime]);

  if (isLoading && !activeData) {
    return (
      <div
        className={cn(
          'w-full h-full bg-muted animate-pulse flex items-center justify-center text-xs text-muted-foreground',
          className
        )}
      >
        Loading...
      </div>
    );
  }

  if (!activeData) {
    return (
      <div
        className={cn(
          'w-full h-full bg-black flex items-center justify-center text-xs text-muted-foreground',
          className
        )}
      >
        No signal
      </div>
    );
  }

  const { file, config } = activeData;
  const url = pb.files.getURL(file, file.file as string);

  // Calculate local time within this filmstrip segment
  const localTime = Math.max(0, currentTime - config.startTime);

  // Calculate frame index
  // Note: config.fps is typically 1 for these filmstrips
  const frameIndex = Math.floor(localTime * config.fps);
  const totalFrames = config.cols * config.rows;
  const safeFrameIndex = Math.min(Math.max(frameIndex, 0), totalFrames - 1);

  // Calculate grid position
  const col = safeFrameIndex % config.cols;
  const row = Math.floor(safeFrameIndex / config.cols);

  // Calculate background size and position using percentages
  // This ensures the current tile fills the container perfectly
  const bgWidth = config.cols * 100;
  const bgHeight = config.rows * 100;

  // For background-position, we use the formula: (index / (total - 1)) * 100%
  // This maps the centers of the tiles correctly for background positioning
  const posX = config.cols > 1 ? (col / (config.cols - 1)) * 100 : 0;
  const posY = config.rows > 1 ? (row / (config.rows - 1)) * 100 : 0;

  return (
    <div
      className={cn('w-full h-full overflow-hidden bg-black', className)}
      style={{
        backgroundImage: `url('${url}')`,
        backgroundPosition: `${posX}% ${posY}%`,
        backgroundSize: `${bgWidth}% ${bgHeight}%`,
        backgroundRepeat: 'no-repeat',
      }}
      role="img"
      aria-label={`Filmstrip frame at ${currentTime.toFixed(1)}s`}
    />
  );
}
