'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useTimeline } from '@/hooks/use-timeline';
import { TimelineClipItem } from './timeline-clip-item';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Film, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DragData {
  type: 'media-clip' | 'timeline-clip';
  clipId?: string;
  mediaId?: string;
  start?: number;
  end?: number;
  clipType?: string;
  index?: number;
}

export function TimelineTrack() {
  const {
    timeline,
    reorderClips,
    addClip,
    isLoading,
    selectedClipId,
    setSelectedClipId,
  } = useTimeline();
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  const [isDropZoneActive, setIsDropZoneActive] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Memoize clips to prevent dependency changes on every render
  const clips = React.useMemo(() => timeline?.clips ?? [], [timeline?.clips]);

  // Handle horizontal scroll with vertical mouse wheel
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      // Only handle vertical wheel events
      if (e.deltaY !== 0) {
        e.preventDefault();
        // Scroll horizontally based on vertical wheel movement
        container.scrollLeft += e.deltaY;
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, []);

  const handleDragStart = useCallback((index: number) => {
    setDraggedIndex(index);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggedIndex(null);
    setDropTargetIndex(null);
  }, []);

  const parseDragData = useCallback((e: React.DragEvent): DragData | null => {
    try {
      const jsonData = e.dataTransfer.getData('application/json');
      if (jsonData) {
        return JSON.parse(jsonData) as DragData;
      }
    } catch {
      // Not JSON data
    }
    return null;
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent, index: number) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = draggedIndex !== null ? 'move' : 'copy';
      setDropTargetIndex(index);
    },
    [draggedIndex]
  );

  const handleDragLeave = useCallback(() => {
    setDropTargetIndex(null);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent, targetIndex: number) => {
      e.preventDefault();
      setDropTargetIndex(null);
      setIsDropZoneActive(false);

      const dragData = parseDragData(e);

      if (
        dragData?.type === 'media-clip' &&
        dragData.mediaId &&
        dragData.start !== undefined &&
        dragData.end !== undefined
      ) {
        try {
          await addClip(
            dragData.mediaId,
            dragData.start,
            dragData.end,
            dragData.clipId
          );
        } catch (error) {
          console.error('Failed to add clip from browser:', error);
        }
        return;
      }

      if (draggedIndex === null || draggedIndex === targetIndex) {
        setDraggedIndex(null);
        return;
      }

      const newClipOrders = clips.map((clip, index) => {
        if (index === draggedIndex) {
          return { id: clip.id, order: targetIndex };
        }
        if (draggedIndex < targetIndex) {
          if (index > draggedIndex && index <= targetIndex) {
            return { id: clip.id, order: index - 1 };
          }
        } else {
          if (index >= targetIndex && index < draggedIndex) {
            return { id: clip.id, order: index + 1 };
          }
        }
        return { id: clip.id, order: index };
      });

      try {
        await reorderClips(newClipOrders);
      } catch (error) {
        console.error('Failed to reorder clips:', error);
      }
      setDraggedIndex(null);
    },
    [draggedIndex, clips, reorderClips, addClip, parseDragData]
  );

  const handleDropZoneDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDropZoneActive(true);
  }, []);

  const handleDropZoneDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDropZoneDragLeave = useCallback((e: React.DragEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const { clientX, clientY } = e;
    if (
      clientX < rect.left ||
      clientX > rect.right ||
      clientY < rect.top ||
      clientY > rect.bottom
    ) {
      setIsDropZoneActive(false);
    }
  }, []);

  const handleDropZoneDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDropZoneActive(false);
      const dragData = parseDragData(e);
      if (
        dragData?.type === 'media-clip' &&
        dragData.mediaId &&
        dragData.start !== undefined &&
        dragData.end !== undefined
      ) {
        try {
          await addClip(
            dragData.mediaId,
            dragData.start,
            dragData.end,
            dragData.clipId
          );
        } catch (error) {
          console.error('Failed to add clip from browser:', error);
        }
      }
    },
    [addClip, parseDragData]
  );

  if (clips.length === 0) {
    return (
      <div
        onDragEnter={handleDropZoneDragEnter}
        onDragOver={handleDropZoneDragOver}
        onDragLeave={handleDropZoneDragLeave}
        onDrop={handleDropZoneDrop}
        className={cn(
          'flex flex-col items-center justify-center py-12 px-4 rounded-lg border-2 border-dashed transition-colors',
          isDropZoneActive
            ? 'border-primary bg-primary/5'
            : 'border-muted-foreground/25'
        )}
      >
        <div
          className={cn(
            'flex flex-col items-center text-center',
            isDropZoneActive ? 'text-primary' : 'text-muted-foreground'
          )}
        >
          {isDropZoneActive ? (
            <>
              <Plus className="h-10 w-10 mb-2" />
              <p className="text-sm font-medium">Drop clip here to add</p>
            </>
          ) : (
            <>
              <Film className="h-10 w-10 mb-2 opacity-50" />
              <p className="text-sm">No clips in timeline</p>
              <p className="text-xs mt-1">
                Drag clips from the browser to add them
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div
        ref={scrollContainerRef}
        className="flex gap-2 overflow-x-auto pb-2 scroll-smooth"
        style={{ scrollbarWidth: 'thin' }}
      >
        {clips.map((clip, index) => (
          <React.Fragment key={clip.id}>
            {/* Drop indicator - appears before the card when dragging */}
            {dropTargetIndex === index && draggedIndex !== index && (
              <div className="flex-shrink-0 flex items-center justify-center w-1 relative z-50">
                <div className="absolute inset-y-0 w-1 bg-primary/60 rounded-full shadow-md" />
              </div>
            )}
            <div
              onDragOver={(e) => handleDragOver(e, index)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, index)}
              className="relative flex-shrink-0"
            >
              <TimelineClipItem
                clip={clip}
                onDragStart={() => handleDragStart(index)}
                onDragEnd={handleDragEnd}
                isDragging={draggedIndex === index}
                isSelected={selectedClipId === clip.id}
                onSelect={() => setSelectedClipId(clip.id)}
              />
            </div>
          </React.Fragment>
        ))}
        <div
          onDragEnter={handleDropZoneDragEnter}
          onDragOver={handleDropZoneDragOver}
          onDragLeave={handleDropZoneDragLeave}
          onDrop={handleDropZoneDrop}
          className={cn(
            'flex items-center justify-center w-24 min-h-[140px] rounded-lg border-2 border-dashed transition-colors flex-shrink-0',
            isDropZoneActive
              ? 'border-primary bg-primary/5'
              : 'border-muted-foreground/25'
          )}
        >
          <div
            className={cn(
              'flex flex-col items-center',
              isDropZoneActive ? 'text-primary' : 'text-muted-foreground/50'
            )}
          >
            <Plus className="h-6 w-6" />
            <span className="text-xs mt-1">Add</span>
          </div>
        </div>
      </div>
      {isLoading && (
        <Alert>
          <AlertDescription>Updating timeline...</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
