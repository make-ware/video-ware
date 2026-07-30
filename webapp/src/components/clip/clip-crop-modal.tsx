'use client';

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Check, Crop, RotateCcw, ZoomIn } from 'lucide-react';
import { VideoPlayerUI } from '@/components/video/video-player-ui';
import { MEDIA_PREVIEW_FRAME } from '@/components/video/media-preview-frame';
import { useVideoSource } from '@/hooks/use-video-source';
import { useVideoPlayhead } from '@/hooks/use-video-playhead';
import {
  mediaDisplayDimensions,
  sanitizeCropRect,
  type CropRect,
  type Media,
} from '@project/shared';
import type { ExpandedMedia } from '@/types/expanded-types';
import { containBox } from '@/components/timeline/editor/crop-preview-style';
import {
  CROP_PRESETS,
  MAX_CROP_ZOOM,
  MIN_CROP_ZOOM,
  cropStateFromRect,
  deriveCropRect,
  presetAspect,
  type CropPreset,
} from './crop-model';
import { CropRectOverlay } from './crop-rect-overlay';
import { formatClipTime } from '@/utils/format-clip-time';
import { cn } from '@/lib/utils';

export interface ClipCropModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  media: Media | ExpandedMedia;
  /** The clip's current crop override, if any. */
  currentCrop: CropRect | null;
  /** The media's default crop (what "Reset to default" falls back to). */
  mediaCrop: CropRect | null;
  initialPlayhead?: number;
  /**
   * Hand the framing back to the clip editor (no persistence): a rect sets
   * the override, null resets to the default.
   */
  onApply: (rect: CropRect | null) => void;
}

/** Pixel aspect of the frame box (MEDIA_PREVIEW_FRAME is aspect-video). */
const FRAME_ASPECT = 16 / 9;

/**
 * Reframe dialog: choose an aspect preset, then pan (drag the window) and
 * zoom (slider/wheel) over the always-full source frame. The rect derived
 * from preset+zoom+center is the single source of truth — Apply hands it to
 * the clip editor, which persists it on Save like every other clip property.
 */
export function ClipCropModal({
  open,
  onOpenChange,
  media,
  currentCrop,
  mediaCrop,
  initialPlayhead,
  onApply,
}: ClipCropModalProps) {
  const { src, poster } = useVideoSource(media);
  const { registerVideo, handleScrub, currentVideoTime } =
    useVideoPlayhead(initialPlayhead);
  const mediaDuration = media.duration ?? 0;

  const display = mediaDisplayDimensions(media);
  const mediaAspect = display.aspect;

  // Aspect/zoom/center are the editable state; the rect is derived. Seeded
  // from the current override, else the media default, else the full frame.
  const initial = useMemo(() => {
    const seed =
      sanitizeCropRect(currentCrop) ?? sanitizeCropRect(mediaCrop) ?? null;
    if (seed && mediaAspect > 0) {
      const state = cropStateFromRect(seed, mediaAspect);
      return {
        preset: state.preset,
        aspect: state.aspect,
        zoom: state.zoom,
        center: state.center,
      };
    }
    return {
      preset: 'original' as CropPreset | null,
      aspect: mediaAspect,
      zoom: 1,
      center: { x: 0.5, y: 0.5 },
    };
  }, [currentCrop, mediaCrop, mediaAspect]);

  const [preset, setPreset] = useState<CropPreset | null>(initial.preset);
  const [aspect, setAspect] = useState(initial.aspect);
  const [zoom, setZoom] = useState(initial.zoom);
  const [center, setCenter] = useState(initial.center);

  const rect = useMemo(
    () => deriveCropRect({ mediaAspect, aspect, zoom, center }),
    [mediaAspect, aspect, zoom, center]
  );

  // The overlay lives inside the media's CONTENT box within the 16:9 frame
  // (object-contain letterboxes non-16:9 media), so rect percentages map
  // 1:1 onto frame pixels.
  const contentBox = useMemo(() => {
    const box = containBox(
      FRAME_ASPECT,
      mediaAspect > 0 ? mediaAspect : FRAME_ASPECT
    );
    return {
      left: `${box.left}%`,
      top: `${box.top}%`,
      width: `${box.width}%`,
      height: `${box.height}%`,
    };
  }, [mediaAspect]);

  const contentRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startCenter: { x: number; y: number };
    box: DOMRect;
  } | null>(null);

  const selectPreset = useCallback(
    (key: CropPreset) => {
      setPreset(key);
      setAspect(presetAspect(key, mediaAspect));
    },
    [mediaAspect]
  );

  const nudgeZoom = useCallback((delta: number) => {
    setZoom((z) => Math.min(MAX_CROP_ZOOM, Math.max(MIN_CROP_ZOOM, z + delta)));
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const box = contentRef.current?.getBoundingClientRect();
      if (!box || box.width <= 0 || box.height <= 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startCenter: center,
        box,
      };
    },
    [center]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      setCenter({
        x: drag.startCenter.x + (e.clientX - drag.startX) / drag.box.width,
        y: drag.startCenter.y + (e.clientY - drag.startY) / drag.box.height,
      });
    },
    []
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null;
    },
    []
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      nudgeZoom(e.deltaY < 0 ? 0.25 : -0.25);
    },
    [nudgeZoom]
  );

  const apply = useCallback(() => {
    onApply(rect);
    onOpenChange(false);
  }, [onApply, onOpenChange, rect]);

  const resetToDefault = useCallback(() => {
    onApply(null);
    onOpenChange(false);
  }, [onApply, onOpenChange]);

  // Arrows pan, +/- zoom, Enter applies. Esc closes via the Dialog itself.
  useEffect(() => {
    if (!open) return;
    const isInteractive = (el: HTMLElement | null) =>
      !!el?.closest(
        'input, textarea, select, button, [role="slider"], [contenteditable="true"]'
      );
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        apply();
        return;
      }
      if (isInteractive(e.target as HTMLElement | null)) return;
      const step = e.shiftKey ? 0.05 : 0.01;
      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          setCenter((c) => ({ ...c, x: c.x - step }));
          break;
        case 'ArrowRight':
          e.preventDefault();
          setCenter((c) => ({ ...c, x: c.x + step }));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setCenter((c) => ({ ...c, y: c.y - step }));
          break;
        case 'ArrowDown':
          e.preventDefault();
          setCenter((c) => ({ ...c, y: c.y + step }));
          break;
        case '+':
        case '=':
          e.preventDefault();
          nudgeZoom(0.25);
          break;
        case '-':
          e.preventDefault();
          nudgeZoom(-0.25);
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, apply, nudgeZoom]);

  const pixelReadout = useMemo(() => {
    if (!(display.width > 0)) return null;
    const w = Math.round(rect.width * display.width);
    const h = Math.round(rect.height * display.height);
    return `${w}×${h}px`;
  }, [display, rect]);

  const defaultLabel = sanitizeCropRect(mediaCrop)
    ? 'Media crop'
    : 'Full frame';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Crop className="h-5 w-5 text-primary" />
            Edit Framing
          </DialogTitle>
          <DialogDescription className="sr-only">
            Pick an aspect, then drag to pan and zoom the crop window over the
            source frame.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Full source frame with the crop window over the content box */}
          <div className={MEDIA_PREVIEW_FRAME}>
            {src ? (
              <VideoPlayerUI
                src={src}
                poster={poster}
                autoPlay={false}
                preload="auto"
                seekOnStartTimeChange={false}
                clampToRange={false}
                className="w-full h-full"
                ref={registerVideo}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                No preview available
              </div>
            )}
            <div
              ref={contentRef}
              className="absolute overflow-hidden"
              style={contentBox}
            >
              <CropRectOverlay
                rect={rect}
                interactive
                label={pixelReadout ?? undefined}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onWheel={handleWheel}
              />
            </div>
          </div>

          {/* Scrub to check the framing across the clip */}
          {mediaDuration > 0 && (
            <div className="flex items-center gap-3">
              <Slider
                value={[currentVideoTime]}
                onValueChange={([v]) => handleScrub(v)}
                min={0}
                max={mediaDuration}
                step={0.1}
                className="flex-1"
              />
              <span className="w-16 text-right text-xs font-mono text-muted-foreground">
                {formatClipTime(currentVideoTime)}
              </span>
            </div>
          )}

          {/* Aspect presets */}
          <div className="flex items-center gap-2">
            {CROP_PRESETS.map((p) => (
              <Button
                key={p.key}
                type="button"
                size="sm"
                variant={preset === p.key ? 'default' : 'outline'}
                className={cn(
                  'px-3',
                  preset === p.key && 'pointer-events-none'
                )}
                onClick={() => selectPreset(p.key)}
              >
                {p.label}
              </Button>
            ))}
            {preset === null && (
              <span className="text-xs text-muted-foreground">Custom</span>
            )}
          </div>

          {/* Zoom */}
          <div className="flex items-center gap-3">
            <ZoomIn className="h-4 w-4 text-muted-foreground" />
            <Slider
              value={[zoom]}
              onValueChange={([v]) => setZoom(v)}
              min={MIN_CROP_ZOOM}
              max={MAX_CROP_ZOOM}
              step={0.05}
              className="flex-1"
            />
            <span className="w-12 text-right text-sm font-mono text-muted-foreground">
              {zoom.toFixed(2)}×
            </span>
          </div>
        </div>

        <DialogFooter className="flex justify-between sm:justify-between items-center">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={resetToDefault}
          >
            <RotateCcw className="h-4 w-4 mr-1" />
            Reset to default ({defaultLabel})
          </Button>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="button" onClick={apply}>
              <Check className="h-4 w-4 mr-1" />
              Apply
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
