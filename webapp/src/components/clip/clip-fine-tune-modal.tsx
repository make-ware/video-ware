'use client';

import React, { useState, useCallback, useEffect, useId } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertCircle,
  Check,
  LogIn,
  LogOut,
  Redo2,
  RotateCcw,
  Scissors,
  SlidersHorizontal,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { VideoPlayerUI } from '@/components/video/video-player-ui';
import { MEDIA_PREVIEW_FRAME } from '@/components/video/media-preview-frame';
import { useVideoSource } from '@/hooks/use-video-source';
import { useVideoPlayhead } from '@/hooks/use-video-playhead';
import { useViewWindow } from '@/hooks/use-view-window';
import { WindowScrollbar } from '@/components/video/window-scrollbar';
import { useFineTune } from './use-fine-tune';
import { ClipSegmentStrip } from './clip-segment-strip';
import type { Segment } from '@/components/timeline/segment-editor';
import type { Media } from '@project/shared';
import type { ExpandedMedia } from '@/types/expanded-types';
import { formatClipTime } from '@/utils/format-clip-time';

export interface ClipFineTuneModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  media: Media | ExpandedMedia;
  /** Current edit list; a single trim-window segment when not composite yet. */
  initialSegments: Segment[];
  initialPlayhead?: number;
  /** Hand the fine-tuned edit list back to the clip editor (no persistence). */
  onApply: (segments: Segment[]) => void;
}

const NUDGE = 0.1;

function isImageMedia(media: Media | ExpandedMedia): boolean {
  const type = Array.isArray(media.mediaType)
    ? media.mediaType[0]
    : media.mediaType;
  return type === 'image';
}

/**
 * Dedicated fine-tuning dialog for a clip's edit list — the webapp
 * counterpart of `vw … split/cut/trim/slip`. It edits segments locally
 * (undoable) via the shared segment-edit functions; "Apply" hands the result
 * back to the clip editor, which converts the clip to composite on save.
 */
export function ClipFineTuneModal({
  open,
  onOpenChange,
  media,
  initialSegments,
  initialPlayhead,
  onApply,
}: ClipFineTuneModalProps) {
  const isImage = isImageMedia(media);
  const mediaDuration = media.duration ?? 0;
  const { src, poster } = useVideoSource(media);
  const { currentVideoTime, videoRef, registerVideo, handleScrub } =
    useVideoPlayhead(initialPlayhead);

  const fineTune = useFineTune({ initialSegments, mediaDuration, isImage });
  const {
    segments,
    times,
    initialTimes,
    selectedIndex,
    setSelectedIndex,
    error,
  } = fineTune;

  // Cut range markers (source-media seconds), set from the playhead
  const [markIn, setMarkIn] = useState<number | null>(null);
  const [markOut, setMarkOut] = useState<number | null>(null);
  // Informational notice (e.g. a clamped slip), distinct from errors
  const [notice, setNotice] = useState<string | null>(null);

  const stripDuration = mediaDuration > 0 ? mediaDuration : times.end || 1;

  // Zoomable/pannable view window over the media; defaults to the segment
  // span with wiggle room, zoom-out gated at the full media length.
  const {
    view: displayRange,
    canZoomIn,
    canZoomOut,
    zoomIn,
    zoomOut,
    panTo,
  } = useViewWindow({
    total: stripDuration,
    contentStart: times.start,
    contentEnd: times.end,
  });
  const stripId = useId();

  const canCutMarks = markIn !== null && markOut !== null && markIn < markOut;

  const handleSplit = useCallback(() => {
    setNotice(null);
    fineTune.split(currentVideoTime);
  }, [fineTune, currentVideoTime]);

  const handleCutMarks = useCallback(() => {
    if (markIn === null || markOut === null) return;
    setNotice(null);
    if (fineTune.cut(markIn, markOut)) {
      setMarkIn(null);
      setMarkOut(null);
    }
  }, [fineTune, markIn, markOut]);

  const handleTrimNudge = useCallback(
    (edge: 'start' | 'end', delta: number) => {
      if (selectedIndex === null) return;
      const seg = segments[selectedIndex];
      if (!seg) return;
      setNotice(null);
      fineTune.trim(selectedIndex, { [edge]: seg[edge] + delta });
    },
    [fineTune, selectedIndex, segments]
  );

  const handleTrimToPlayhead = useCallback(
    (edge: 'start' | 'end') => {
      if (selectedIndex === null) return;
      setNotice(null);
      fineTune.trim(selectedIndex, { [edge]: currentVideoTime });
    },
    [fineTune, selectedIndex, currentVideoTime]
  );

  const handleSlip = useCallback(
    (by: number) => {
      setNotice(null);
      const applied = fineTune.slip(by, selectedIndex);
      if (applied !== null && Math.abs(applied - by) > 0.0005) {
        setNotice(
          `Slipped ${applied >= 0 ? '+' : ''}${applied.toFixed(2)}s ` +
            `(requested ${by >= 0 ? '+' : ''}${by.toFixed(2)}s — clamped)`
        );
      }
    },
    [fineTune, selectedIndex]
  );

  // Direct-manipulation commits from the strip (each is one undo entry). The
  // strip has already clamped the drag, so these apply the final value as-is.
  const handleMove = useCallback(
    (index: number, delta: number) => {
      setNotice(null);
      fineTune.slip(delta, index);
    },
    [fineTune]
  );

  const handleTrimDrag = useCallback(
    (index: number, edge: 'start' | 'end', time: number) => {
      setNotice(null);
      fineTune.trim(index, { [edge]: time });
    },
    [fineTune]
  );

  const handleDelete = useCallback(
    (index: number) => {
      setNotice(null);
      fineTune.remove(index);
    },
    [fineTune]
  );

  const handleApply = useCallback(() => {
    onApply(segments);
    onOpenChange(false);
  }, [onApply, segments, onOpenChange]);

  // Keyboard shortcuts, mirroring the clip editor's pattern (the parent
  // modal suspends its own shortcuts while this dialog is open).
  useEffect(() => {
    if (!open) return;

    const isInteractive = (el: HTMLElement | null) =>
      !!el?.closest(
        'input, textarea, select, button, [role="slider"], [contenteditable="true"]'
      );

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (fineTune.hasChanges) handleApply();
        return;
      }
      if ((e.key === 'z' || e.key === 'Z') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (e.shiftKey) {
          fineTune.redo();
        } else {
          fineTune.undo();
        }
        return;
      }

      if (isInteractive(e.target as HTMLElement | null)) return;

      const video = videoRef.current;
      switch (e.key) {
        case 's':
        case 'S':
          e.preventDefault();
          handleSplit();
          break;
        case 'i':
        case 'I':
          e.preventDefault();
          setMarkIn(currentVideoTime);
          break;
        case 'o':
        case 'O':
          e.preventDefault();
          setMarkOut(currentVideoTime);
          break;
        case 'x':
        case 'X':
          if (canCutMarks) {
            e.preventDefault();
            handleCutMarks();
          }
          break;
        case 'Backspace':
        case 'Delete':
          if (selectedIndex !== null) {
            e.preventDefault();
            handleDelete(selectedIndex);
          }
          break;
        case ' ':
          e.preventDefault();
          if (video) {
            if (video.paused) {
              void video.play();
            } else {
              video.pause();
            }
          }
          break;
        case 'ArrowLeft':
        case 'ArrowRight': {
          e.preventDefault();
          const step =
            (e.shiftKey ? 1 : 0.1) * (e.key === 'ArrowLeft' ? -1 : 1);
          handleScrub(
            Math.min(stripDuration, Math.max(0, currentVideoTime + step))
          );
          break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    open,
    fineTune,
    handleApply,
    handleSplit,
    handleCutMarks,
    canCutMarks,
    handleDelete,
    selectedIndex,
    currentVideoTime,
    handleScrub,
    stripDuration,
    videoRef,
  ]);

  const selectedSegment =
    selectedIndex !== null ? segments[selectedIndex] : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SlidersHorizontal className="h-5 w-5 text-primary" />
            Fine-tune Segments
          </DialogTitle>
          <DialogDescription>
            Split, cut, trim, and slip this clip&apos;s edit list. Changes apply
            back to the clip editor — nothing is saved until you save the clip.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Video preview */}
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
          </div>

          {/* Segment strip */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground font-mono">
              <span>{formatClipTime(displayRange.from)}</span>
              <span className="font-sans">
                Playhead: {formatClipTime(currentVideoTime)}
              </span>
              <span>{formatClipTime(displayRange.to)}</span>
            </div>
            <ClipSegmentStrip
              id={stripId}
              segments={segments}
              displayRange={displayRange}
              selectedIndex={selectedIndex}
              currentTime={currentVideoTime}
              markIn={markIn}
              markOut={markOut}
              mediaDuration={mediaDuration}
              isImage={isImage}
              onSelect={setSelectedIndex}
              onScrub={handleScrub}
              onMove={handleMove}
              onTrim={handleTrimDrag}
              onDelete={handleDelete}
            />
            <WindowScrollbar
              className="pt-1"
              controlsId={stripId}
              total={stripDuration}
              view={displayRange}
              onPan={panTo}
              onZoomIn={zoomIn}
              onZoomOut={zoomOut}
              canZoomIn={canZoomIn}
              canZoomOut={canZoomOut}
            />
          </div>

          {/* Playhead ops */}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleSplit}>
              <Scissors className="h-3.5 w-3.5 mr-1" />
              Split at playhead
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMarkIn(currentVideoTime)}
            >
              <LogIn className="h-3.5 w-3.5 mr-1" />
              Mark in
              {markIn !== null && (
                <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                  {formatClipTime(markIn)}
                </span>
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMarkOut(currentVideoTime)}
            >
              <LogOut className="h-3.5 w-3.5 mr-1" />
              Mark out
              {markOut !== null && (
                <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                  {formatClipTime(markOut)}
                </span>
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!canCutMarks}
              onClick={handleCutMarks}
              className="text-destructive hover:text-destructive"
            >
              <X className="h-3.5 w-3.5 mr-1" />
              Cut marked range
            </Button>
            {(markIn !== null || markOut !== null) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setMarkIn(null);
                  setMarkOut(null);
                }}
              >
                Clear marks
              </Button>
            )}
            <div className="flex-1" />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              disabled={!fineTune.canUndo}
              onClick={fineTune.undo}
              title="Undo (⌘Z)"
            >
              <Undo2 className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              disabled={!fineTune.canRedo}
              onClick={fineTune.redo}
              title="Redo (⇧⌘Z)"
            >
              <Redo2 className="h-4 w-4" />
            </Button>
          </div>

          {/* Segment ops: trim (selection required) + slip */}
          <div className="rounded-lg border p-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-medium text-muted-foreground">
                {selectedSegment && selectedIndex !== null
                  ? `Segment ${selectedIndex} — ${formatClipTime(selectedSegment.start)} – ${formatClipTime(selectedSegment.end)} (${formatClipTime(selectedSegment.end - selectedSegment.start)})`
                  : 'Tap to select · drag a segment to slip · drag its edges to trim'}
              </div>
              {selectedIndex !== null && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-destructive hover:text-destructive"
                  disabled={segments.length <= 1}
                  onClick={() => handleDelete(selectedIndex)}
                  title="Delete segment (Del)"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  Delete
                </Button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground w-9">Start</span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-2 font-mono text-xs"
                  disabled={selectedIndex === null}
                  onClick={() => handleTrimNudge('start', -NUDGE)}
                >
                  -0.1
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-2 font-mono text-xs"
                  disabled={selectedIndex === null}
                  onClick={() => handleTrimNudge('start', NUDGE)}
                >
                  +0.1
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-2 text-xs"
                  disabled={selectedIndex === null}
                  onClick={() => handleTrimToPlayhead('start')}
                >
                  <LogIn className="h-3 w-3 mr-1" />
                  Playhead
                </Button>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground w-7">End</span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-2 font-mono text-xs"
                  disabled={selectedIndex === null}
                  onClick={() => handleTrimNudge('end', -NUDGE)}
                >
                  -0.1
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-2 font-mono text-xs"
                  disabled={selectedIndex === null}
                  onClick={() => handleTrimNudge('end', NUDGE)}
                >
                  +0.1
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-2 text-xs"
                  disabled={selectedIndex === null}
                  onClick={() => handleTrimToPlayhead('end')}
                >
                  <LogOut className="h-3 w-3 mr-1" />
                  Playhead
                </Button>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">
                  Slip {selectedIndex !== null ? `seg ${selectedIndex}` : 'all'}
                </span>
                {[-1, -NUDGE, NUDGE, 1].map((by) => (
                  <Button
                    key={by}
                    variant="outline"
                    size="sm"
                    className="h-8 px-2 font-mono text-xs"
                    onClick={() => handleSlip(by)}
                  >
                    {by > 0 ? `+${by}` : by}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          {/* Error / notice */}
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {notice && !error && (
            <div className="text-xs text-muted-foreground">{notice}</div>
          )}

          {/* Keyboard hints (desktop only) */}
          <div className="hidden lg:flex items-center justify-center gap-4 text-[11px] text-muted-foreground">
            {(
              [
                ['S', 'split'],
                ['I / O', 'mark in/out'],
                ['X', 'cut marked'],
                ['Del', 'delete segment'],
                ['Space', 'play/pause'],
                ['⌘Z', 'undo'],
                ['⌘↵', 'apply'],
              ] as const
            ).map(([key, label]) => (
              <span key={key}>
                <kbd className="px-1 py-0.5 rounded border bg-muted font-mono text-[10px]">
                  {key}
                </kbd>{' '}
                {label}
              </span>
            ))}
          </div>
        </div>

        <DialogFooter className="flex-row items-center justify-between sm:justify-between gap-2">
          <div className="text-xs text-muted-foreground font-mono">
            {segments.length} segment{segments.length === 1 ? '' : 's'} ·{' '}
            {formatClipTime(initialTimes.duration)} →{' '}
            {formatClipTime(times.duration)}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={!fineTune.hasChanges}
              onClick={fineTune.reset}
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1" />
              Reset
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!fineTune.hasChanges || segments.length === 0}
              onClick={handleApply}
            >
              <Check className="h-4 w-4 mr-1" />
              Apply changes
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
