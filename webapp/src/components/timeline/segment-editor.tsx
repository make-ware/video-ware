'use client';

import React, {
  useState,
  useMemo,
  useRef,
  useEffect,
  useCallback,
} from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Plus, Trash2, GripVertical, Layers, ZoomIn } from 'lucide-react';
import { cn } from '@/lib/utils';
import { calculateEffectiveDuration } from '@project/shared';
import { TimeInput } from './time-input';

export interface Segment {
  start: number;
  end: number;
}

interface SegmentEditorProps {
  /** The composite segments */
  segments: Segment[];
  /** Maximum duration (media length) */
  mediaDuration: number;
  /** Called when segments change */
  onChange: (segments: Segment[]) => void;
  /** Optional className */
  className?: string;
}

/**
 * Component for editing composite clip segments.
 * Allows adding, removing, and adjusting segment boundaries.
 */
export function SegmentEditor({
  segments,
  mediaDuration,
  onChange,
  className,
}: SegmentEditorProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [isZoomed, setIsZoomed] = useState(false);
  const [dragging, setDragging] = useState<{
    index: number;
    handle: 'start' | 'end';
    initialX: number;
    initialTime: number;
  } | null>(null);

  const timelineRef = useRef<HTMLDivElement>(null);

  // Calculate display range for zoom
  const displayRange = useMemo(() => {
    if (!isZoomed || segments.length === 0) {
      return { start: 0, end: mediaDuration };
    }
    const starts = segments.map((s) => s.start);
    const ends = segments.map((s) => s.end);
    const minStart = Math.min(...starts);
    const maxEnd = Math.max(...ends);
    // Tighter zoom: less padding when zooming to fill
    const padding = Math.max(0.5, (maxEnd - minStart) * 0.05);
    return {
      start: Math.max(0, minStart - padding),
      end: Math.min(mediaDuration, maxEnd + padding),
    };
  }, [isZoomed, segments, mediaDuration]);

  const displayDuration = displayRange.end - displayRange.start;

  // Calculate effective duration
  const effectiveDuration = useMemo(
    () => calculateEffectiveDuration(0, mediaDuration, segments),
    [segments, mediaDuration]
  );

  // Calculate total gap time
  const gapDuration = useMemo(() => {
    if (segments.length === 0) return 0;
    const sorted = [...segments].sort((a, b) => a.start - b.start);
    let gaps = 0;
    for (let i = 0; i < sorted.length - 1; i++) {
      gaps += Math.max(0, sorted[i + 1].start - sorted[i].end);
    }
    return gaps;
  }, [segments]);

  const handleSegmentChange = useCallback(
    (index: number, field: 'start' | 'end', value: number) => {
      const newSegments = [...segments];
      const current = newSegments[index];
      const newValue = Math.max(0, Math.min(mediaDuration, value));

      if (field === 'start') {
        // Ensure start doesn't cross end
        newSegments[index] = {
          ...current,
          start: Math.min(newValue, current.end - 0.1),
        };
      } else {
        // Ensure end doesn't cross start
        newSegments[index] = {
          ...current,
          end: Math.max(newValue, current.start + 0.1),
        };
      }

      onChange(newSegments);
    },
    [segments, mediaDuration, onChange]
  );

  const handleMouseDown = useCallback(
    (
      e: React.MouseEvent | React.TouchEvent,
      index: number,
      handle: 'start' | 'end'
    ) => {
      e.stopPropagation();
      e.preventDefault();
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const seg = segments[index];
      setDragging({
        index,
        handle,
        initialX: clientX,
        initialTime: handle === 'start' ? seg.start : seg.end,
      });
    },
    [segments]
  );

  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e: MouseEvent | TouchEvent) => {
      if (!timelineRef.current) return;
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const rect = timelineRef.current.getBoundingClientRect();

      const deltaX = clientX - dragging.initialX;
      const deltaTime = (deltaX / rect.width) * displayDuration;

      handleSegmentChange(
        dragging.index,
        dragging.handle,
        dragging.initialTime + deltaTime
      );
    };

    const handleMouseUp = () => {
      setDragging(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('touchmove', handleMouseMove);
    window.addEventListener('touchend', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleMouseMove);
      window.removeEventListener('touchend', handleMouseUp);
    };
  }, [dragging, displayDuration, handleSegmentChange]);

  const handleAddSegment = () => {
    // Find gap or add at end
    const sorted = [...segments].sort((a, b) => a.start - b.start);
    let newStart = 0;
    let newEnd = 1;

    if (sorted.length > 0) {
      // Try to add after the last segment
      const last = sorted[sorted.length - 1];
      newStart = Math.min(last.end + 0.5, mediaDuration - 0.5);
      newEnd = Math.min(newStart + 1, mediaDuration);
    }

    onChange([...segments, { start: newStart, end: newEnd }]);
  };

  const handleRemoveSegment = (index: number) => {
    if (segments.length <= 1) {
      return; // Don't allow removing the last segment
    }
    const newSegments = segments.filter((_, i) => i !== index);
    onChange(newSegments);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = (seconds % 60).toFixed(1);
    return mins > 0 ? `${mins}:${secs.padStart(4, '0')}` : `${secs}s`;
  };

  // Sort segments for display
  const sortedSegments = useMemo(
    () =>
      segments
        .map((seg, originalIndex) => ({ ...seg, originalIndex }))
        .sort((a, b) => a.start - b.start),
    [segments]
  );

  return (
    <div className={cn('grid gap-4', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-2">
          <Layers className="w-4 h-4" />
          Segments ({segments.length})
        </Label>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>
            Total:{' '}
            <span className="font-mono font-bold text-primary">
              {formatTime(effectiveDuration)}
            </span>
          </span>
          {gapDuration > 0 && (
            <span>
              Gaps: <span className="font-mono">{formatTime(gapDuration)}</span>
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'h-6 w-6',
              isZoomed ? 'text-primary bg-primary/10' : 'text-muted-foreground'
            )}
            onClick={() => setIsZoomed(!isZoomed)}
            title={isZoomed ? 'Zoom Out' : 'Zoom to Fill'}
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Segment Timeline Visualization */}
      <div
        ref={timelineRef}
        className="h-10 bg-muted rounded-lg relative overflow-hidden ring-1 ring-inset ring-black/10 select-none shadow-inner"
      >
        {sortedSegments.map((seg) => {
          const leftPercent =
            ((seg.start - displayRange.start) / displayDuration) * 100;
          const widthPercent = ((seg.end - seg.start) / displayDuration) * 100;

          if (leftPercent + widthPercent < 0 || leftPercent > 100) return null;

          const isExpanded = expandedIndex === seg.originalIndex;

          return (
            <div
              key={seg.originalIndex}
              className={cn(
                'absolute top-0 bottom-0 bg-primary/80 border-x border-white/20 transition-colors hover:bg-primary z-10 group',
                isExpanded && 'bg-primary ring-2 ring-primary ring-inset'
              )}
              style={{ left: `${leftPercent}%`, width: `${widthPercent}%` }}
              onClick={() =>
                setExpandedIndex(isExpanded ? null : seg.originalIndex)
              }
            >
              {/* Left Handle */}
              <div
                className="absolute left-0 top-0 bottom-0 w-2.5 cursor-ew-resize hover:bg-white/30 z-20 flex items-center justify-center"
                onMouseDown={(e) =>
                  handleMouseDown(e, seg.originalIndex, 'start')
                }
                onTouchStart={(e) =>
                  handleMouseDown(e, seg.originalIndex, 'start')
                }
              >
                <div className="w-px h-3 bg-white/50" />
              </div>

              {/* Right Handle */}
              <div
                className="absolute right-0 top-0 bottom-0 w-2.5 cursor-ew-resize hover:bg-white/30 z-20 flex items-center justify-center"
                onMouseDown={(e) =>
                  handleMouseDown(e, seg.originalIndex, 'end')
                }
                onTouchStart={(e) =>
                  handleMouseDown(e, seg.originalIndex, 'end')
                }
              >
                <div className="w-px h-3 bg-white/50" />
              </div>

              <span className="absolute inset-0 flex items-center justify-center text-[10px] font-mono font-bold text-white drop-shadow-sm pointer-events-none">
                {Math.round((seg.end - seg.start) * 10) / 10}s
              </span>
            </div>
          );
        })}
      </div>

      {/* Segment List */}
      <div className="grid gap-2 max-h-48 overflow-y-auto">
        {sortedSegments.map((seg, displayIndex) => (
          <div
            key={seg.originalIndex}
            className={cn(
              'flex items-center gap-2 p-2 rounded-md border transition-colors',
              expandedIndex === seg.originalIndex
                ? 'bg-muted border-primary'
                : 'hover:bg-muted/50'
            )}
            onClick={() =>
              setExpandedIndex(
                expandedIndex === seg.originalIndex ? null : seg.originalIndex
              )
            }
          >
            <GripVertical className="w-4 h-4 text-muted-foreground cursor-grab" />

            <span className="text-xs font-semibold w-6">
              {displayIndex + 1}
            </span>

            <div className="flex items-center gap-1 flex-1">
              <TimeInput
                min={0}
                max={seg.end - 0.1}
                value={seg.start}
                onChange={(val) =>
                  handleSegmentChange(seg.originalIndex, 'start', val)
                }
                onClick={(e) => e.stopPropagation()}
                className="w-full"
              />
              <span className="text-muted-foreground">-</span>
              <TimeInput
                min={seg.start + 0.1}
                max={mediaDuration}
                value={seg.end}
                onChange={(val) =>
                  handleSegmentChange(seg.originalIndex, 'end', val)
                }
                onClick={(e) => e.stopPropagation()}
                className="w-full"
              />
            </div>

            <span className="text-xs text-muted-foreground font-mono w-12 text-right">
              {formatTime(seg.end - seg.start)}
            </span>

            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                handleRemoveSegment(seg.originalIndex);
              }}
              disabled={segments.length <= 1}
            >
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        ))}
      </div>

      {/* Add Segment Button */}
      <Button
        variant="outline"
        size="sm"
        onClick={handleAddSegment}
        className="w-full"
      >
        <Plus className="w-4 h-4 mr-2" />
        Add Segment
      </Button>
    </div>
  );
}
