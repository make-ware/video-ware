'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import {
  getCaptionTextAtTime,
  type CaptionCue,
  type CaptionStyle,
} from '@project/shared';

/** Canvas height the style's pixel font size refers to (1080p baseline) */
const STYLE_CANVAS_HEIGHT = 1080;

export interface CaptionOverlayProps {
  /** Full/fallback text shown when the caption has no cues */
  text: string;
  /** Timed text changes, relative to caption start (seconds) */
  cues?: CaptionCue[];
  style?: CaptionStyle;
  /** Current playback time relative to the caption start (seconds) */
  currentTime: number;
  className?: string;
}

function hexToRgba(hex: string, opacity: number): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!match) return hex;
  const value = parseInt(match[1], 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

/**
 * Renders caption text positioned over video content.
 *
 * Place inside a `relative` container that matches the video frame; the
 * overlay fills it and scales the font with the container height so the
 * preview matches the rendered output. Reusable anywhere captions need to
 * be drawn over media (timeline player, media players, thumbnails).
 */
export function CaptionOverlay({
  text,
  cues,
  style,
  currentTime,
  className,
}: CaptionOverlayProps) {
  const displayText = getCaptionTextAtTime({ text, cues }, currentTime);
  if (!displayText) return null;

  const fontSize = style?.fontSize ?? 48;
  const position = style?.position ?? 'bottom';
  const align = style?.align ?? 'center';

  const justifyContent =
    position === 'top'
      ? 'flex-start'
      : position === 'middle'
        ? 'center'
        : 'flex-end';
  const alignItems =
    align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center';

  const backgroundColor = style?.backgroundColor
    ? hexToRgba(style.backgroundColor, style.backgroundOpacity ?? 0.6)
    : undefined;

  return (
    <div
      className={cn(
        'absolute inset-0 flex flex-col pointer-events-none p-[4%]',
        className
      )}
      style={{ containerType: 'size', justifyContent, alignItems }}
      data-testid="caption-overlay"
    >
      <span
        className="whitespace-pre-wrap max-w-full rounded-sm leading-snug"
        style={{
          fontSize: `${(fontSize / STYLE_CANVAS_HEIGHT) * 100}cqh`,
          color: style?.color ?? '#FFFFFF',
          backgroundColor,
          padding: backgroundColor ? '0.15em 0.4em' : undefined,
          textAlign: align,
          textShadow: backgroundColor
            ? undefined
            : '0 1px 4px rgba(0, 0, 0, 0.8)',
        }}
      >
        {displayText}
      </span>
    </div>
  );
}
