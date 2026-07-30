import { cn } from '@/lib/utils';
import type { SpriteConfig } from './use-sprite-data';

interface SpritePreviewProps {
  url: string;
  config: SpriteConfig;
  frameIndex: number;
  /** Tile aspect ratio from `useSpriteData`; null when it can't be resolved. */
  tileAspect?: number | null;
  className?: string;
}

export function SpritePreview({
  url,
  config,
  frameIndex,
  tileAspect,
  className,
}: SpritePreviewProps) {
  const { cols, rows } = config;
  const col = frameIndex % cols;
  const row = Math.floor(frameIndex / cols);

  // When the tile aspect ratio is known, render each frame with
  // object-fit:cover semantics so portrait/landscape clips aren't stretched
  // to match the card's container shape. Container query units resolve to
  // the wrapper's box, so no ResizeObserver is needed.
  if (tileAspect && tileAspect > 0) {
    const tileW = `max(100cqw, 100cqh * ${tileAspect})`;
    const tileH = `max(100cqh, 100cqw / ${tileAspect})`;
    return (
      <div
        className={cn('absolute inset-0 overflow-hidden', className)}
        style={{ containerType: 'size' }}
      >
        <div
          className="absolute inset-0 bg-no-repeat"
          style={{
            backgroundImage: `url(${url})`,
            backgroundSize: `calc(${cols} * ${tileW}) calc(${rows} * ${tileH})`,
            backgroundPosition: `calc(50cqw - ${col + 0.5} * ${tileW}) calc(50cqh - ${row + 0.5} * ${tileH})`,
          }}
        />
      </div>
    );
  }

  // Fallback for media whose dimensions are unknown: stretch each tile to the
  // container (the only option without an aspect to preserve).
  const xPercent = (col * 100) / (cols - 1 || 1);
  const yPercent = (row * 100) / (rows - 1 || 1);
  return (
    <div
      className={cn('absolute inset-0 bg-no-repeat', className)}
      style={{
        backgroundImage: `url(${url})`,
        backgroundPosition: `${xPercent}% ${yPercent}%`,
        backgroundSize: `${cols * 100}% ${rows * 100}%`,
      }}
    />
  );
}
