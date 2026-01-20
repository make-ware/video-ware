import { cn } from '@/lib/utils';
import type { SpriteConfig } from './use-sprite-data';

interface SpritePreviewProps {
  url: string;
  config: SpriteConfig;
  frameIndex: number;
  className?: string;
}

export function SpritePreview({
  url,
  config,
  frameIndex,
  className,
}: SpritePreviewProps) {
  const { cols, rows } = config;

  // Calculate which tile to show (column and row)
  const col = frameIndex % cols;
  const row = Math.floor(frameIndex / cols);

  // Calculate the exact pixel offset for this tile
  // The sprite sheet is cols*100% wide and rows*100% tall
  // Each tile occupies (100/cols)% width and (100/rows)% height
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
