'use client';

import React, { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Plus,
  Trash2,
  GripVertical,
  Layers,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
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

  // Calculate display range for zoom
  const displayRange = useMemo(() => {
    if (!isZoomed || segments.length === 0) {
      return { start: 0, end: mediaDuration };
    }
    const starts = segments.map((s) => s.start);
    const ends = segments.map((s) => s.end);
    const minStart = Math.min(...starts);
    const maxEnd = Math.max(...ends);
    const padding = Math.max(2, (maxEnd - minStart) * 0.1);
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

  const handleSegmentChange = (
    index: number,
    field: 'start' | 'end',
    value: number
  ) => {
    const newSegments = [...segments];
    newSegments[index] = {
      ...newSegments[index],
      [field]: Math.max(0, Math.min(mediaDuration, value)),
    };

    // Ensure start < end
    if (field === 'start' && value >= newSegments[index].end) {
      newSegments[index].end = Math.min(mediaDuration, value + 0.5);
    }
    if (field === 'end' && value <= newSegments[index].start) {
      newSegments[index].start = Math.max(0, value - 0.5);
    }

    onChange(newSegments);
  };

  const handleAddSegment = () => {
    // Find gap or add at end
    const sorted = [...segments].sort((a, b) => a.start - b.start);
    let newStart = 0;
    let newEnd = 1;

    if (sorted.length > 0) {
      // Try to add after the last segment
      const last = sorted[sorted.length - 1];
      newStart = Math.min(last.end + 0.5, mediaDuration - 1);
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
            title={isZoomed ? 'Zoom Out' : 'Zoom to Segments'}
          >
            {isZoomed ? (
              <ZoomOut className="w-3.5 h-3.5" />
            ) : (
              <ZoomIn className="w-3.5 h-3.5" />
            )}
          </Button>
        </div>
      </div>

      {/* Segment Timeline Visualization */}
      <div className="h-8 bg-muted rounded-lg relative overflow-hidden ring-1 ring-inset ring-black/5">
        {sortedSegments.map((seg, i) => {
          const leftPercent =
            ((seg.start - displayRange.start) / displayDuration) * 100;
          const widthPercent = ((seg.end - seg.start) / displayDuration) * 100;
          if (leftPercent + widthPercent < 0 || leftPercent > 100) return null;
          return (
            <div
              key={seg.originalIndex}
              className={cn(
                'absolute top-0 bottom-0 bg-primary/80 border-r border-white/20 cursor-pointer transition-all hover:bg-primary',
                expandedIndex === seg.originalIndex && 'ring-2 ring-white'
              )}
              style={{ left: `${leftPercent}%`, width: `${widthPercent}%` }}
              onClick={() =>
                setExpandedIndex(
                  expandedIndex === seg.originalIndex ? null : seg.originalIndex
                )
              }
              title={`Segment ${i + 1}: ${formatTime(seg.start)} - ${formatTime(seg.end)}`}
            >
              <span className="absolute inset-0 flex items-center justify-center text-[9px] font-mono text-white/80">
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
