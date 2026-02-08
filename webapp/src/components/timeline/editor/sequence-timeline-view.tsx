'use client';

import React, { useState, useMemo } from 'react';
import { useTimeline } from '@/hooks/use-timeline';
import { cn } from '@/lib/utils';
import { Pencil, GripVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ClipEditModal } from './clip-edit-modal';
import type { TimelineClip } from '@project/shared';

const BLOCK_WIDTH = 160;
const ALL_TRACKS_VALUE = '__all__';

import { SpriteAnimator } from '@/components/sprite/sprite-animator';
import { Film } from 'lucide-react';

interface SequenceClipCardProps {
  clip: TimelineClip;
  isSelected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  isDragged: boolean;
}

function SequenceClipCard({
  clip,
  isSelected,
  onSelect,
  onEdit,
  onDragStart,
  onDragOver,
  onDrop,
  isDragged,
}: SequenceClipCardProps) {
  const [isHovering, setIsHovering] = useState(false);
  const mediaName = clip.expand?.MediaRef?.expand?.UploadRef?.name || 'Clip';
  const displayTitle = clip.meta?.title || mediaName;
  const clipColor = clip.meta?.color || 'bg-blue-600/80';
  const media = clip.expand?.MediaRef;

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      onClick={onSelect}
      className={cn(
        'relative shrink-0 flex flex-col justify-between p-3 rounded-lg border-2 transition-all cursor-grab active:cursor-grabbing group overflow-hidden',
        isSelected
          ? 'border-primary shadow-lg ring-2 ring-primary/20 scale-105 z-10'
          : 'border-border bg-card hover:border-muted-foreground/50',
        isDragged && 'opacity-50',
        'h-[120px] lg:h-[100px]'
      )}
      style={{
        width: BLOCK_WIDTH,
      }}
    >
      {/* Background Sprite Animator */}
      <div className="absolute inset-0 z-0">
        {media ? (
          <SpriteAnimator
            media={media}
            start={clip.start}
            end={clip.end}
            isHovering={isHovering}
            className="opacity-40 group-hover:opacity-60 transition-opacity"
            fallbackIcon={
              <div className="flex items-center justify-center h-full text-muted-foreground/10">
                <Film className="h-8 w-8" />
              </div>
            }
          />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground/10">
            <Film className="h-8 w-8" />
          </div>
        )}
        {/* Subtle Gradient Overlay for readability */}
        <div className="absolute inset-0 bg-gradient-to-b from-background/80 via-background/40 to-background/90 z-0" />
      </div>

      <GripVertical className="absolute top-3 right-2 h-3.5 w-3.5 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors z-10" />

      <div className="flex flex-col gap-1 min-w-0 z-10">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          {(clip.end - clip.start).toFixed(1)}s
        </span>
        <h4 className="text-xs font-semibold truncate leading-tight pr-6">
          {displayTitle}
        </h4>
      </div>

      <div className="flex items-center justify-between mt-auto z-10">
        <div className={cn('w-3 h-3 rounded-full shadow-sm', clipColor)} />
        <Button
          variant="secondary"
          size="icon"
          className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity shadow-md"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
        >
          <Pencil className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

export function SequenceTimelineView() {
  const { timeline, selectedClipId, setSelectedClipId, reorderClips, tracks } =
    useTimeline();

  const [editingClipId, setEditingClipId] = useState<string | null>(null);
  const [draggedClipId, setDraggedClipId] = useState<string | null>(null);
  const [selectedTrackFilter, setSelectedTrackFilter] = useState<string>(ALL_TRACKS_VALUE);

  if (!timeline) return null;

  // Sort tracks by layer (lowest to highest for display order)
  const sortedTracks = useMemo(() => {
    return [...tracks].sort((a, b) => a.layer - b.layer);
  }, [tracks]);

  // Filter clips based on selected track
  const displayClips = useMemo(() => {
    if (selectedTrackFilter === ALL_TRACKS_VALUE) {
      // Show all clips, sorted by track layer then by order
      return [...timeline.clips].sort((a, b) => {
        const aTrack = tracks.find(t => t.id === (a as any).TimelineTrackRef);
        const bTrack = tracks.find(t => t.id === (b as any).TimelineTrackRef);
        const aLayer = aTrack?.layer ?? 0;
        const bLayer = bTrack?.layer ?? 0;

        if (aLayer !== bLayer) {
          return aLayer - bLayer;
        }
        return a.order - b.order;
      });
    } else {
      // Show only clips from selected track
      return timeline.clips.filter(
        (c) => (c as any).TimelineTrackRef === selectedTrackFilter
      ).sort((a, b) => a.order - b.order);
    }
  }, [timeline.clips, selectedTrackFilter, tracks]);

  // Group clips by track when showing all tracks
  const groupedClips = useMemo(() => {
    if (selectedTrackFilter !== ALL_TRACKS_VALUE) {
      return null;
    }

    const groups: Array<{ track: typeof sortedTracks[0] | null; clips: TimelineClip[] }> = [];

    sortedTracks.forEach(track => {
      const trackClips = timeline.clips.filter(
        c => (c as any).TimelineTrackRef === track.id
      ).sort((a, b) => a.order - b.order);

      if (trackClips.length > 0) {
        groups.push({ track, clips: trackClips });
      }
    });

    // Add clips without a track assignment
    const unassignedClips = timeline.clips.filter(
      c => !(c as any).TimelineTrackRef || !tracks.find(t => t.id === (c as any).TimelineTrackRef)
    ).sort((a, b) => a.order - b.order);

    if (unassignedClips.length > 0) {
      groups.push({ track: null, clips: unassignedClips });
    }

    return groups;
  }, [timeline.clips, sortedTracks, tracks, selectedTrackFilter]);

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedClipId(id);
    e.dataTransfer.setData('clipId', id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = async (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const sourceId = e.dataTransfer.getData('clipId');
    if (sourceId === targetId) return;

    const sourceIndex = timeline.clips.findIndex((c) => c.id === sourceId);
    const targetIndex = timeline.clips.findIndex((c) => c.id === targetId);

    if (sourceIndex === -1 || targetIndex === -1) return;

    const newClips = [...timeline.clips];
    const [removed] = newClips.splice(sourceIndex, 1);
    newClips.splice(targetIndex, 0, removed);

    // Map back to expected reorder input format
    const clipOrders = newClips.map((c, index) => ({
      id: c.id,
      order: index,
    }));

    await reorderClips(clipOrders);
    setDraggedClipId(null);
  };

  return (
    <div className="flex flex-col w-full bg-background/30 rounded-lg overflow-hidden h-48 lg:h-40">
      {/* Track Selector */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border/50">
        <span className="text-xs font-medium text-muted-foreground">Track:</span>
        <Select value={selectedTrackFilter} onValueChange={setSelectedTrackFilter}>
          <SelectTrigger className="w-[180px] h-8 text-xs">
            <SelectValue placeholder="Select track" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_TRACKS_VALUE}>All Tracks</SelectItem>
            {sortedTracks.map((track) => (
              <SelectItem key={track.id} value={track.id}>
                {track.name} (Layer {track.layer})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Clips Display */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden p-4 flex items-center gap-3 no-scrollbar">
        {selectedTrackFilter === ALL_TRACKS_VALUE && groupedClips ? (
          // Grouped view: show clips grouped by track with separators
          <>
            {groupedClips.map((group, groupIndex) => (
              <React.Fragment key={group.track?.id || 'unassigned'}>
                {groupIndex > 0 && (
                  <div className="shrink-0 w-px h-16 bg-border/50 mx-2" />
                )}
                <div className="flex items-center gap-3">
                  {/* Track label */}
                  <div className="shrink-0 flex flex-col items-center justify-center px-2 py-1 rounded bg-muted/30 border border-border/30">
                    <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/70">
                      {group.track ? group.track.name : 'Unassigned'}
                    </span>
                    {group.track && (
                      <span className="text-[8px] text-muted-foreground/50">
                        L{group.track.layer}
                      </span>
                    )}
                  </div>
                  {/* Clips in this group */}
                  {group.clips.map((clip) => (
                    <SequenceClipCard
                      key={clip.id}
                      clip={clip}
                      isSelected={selectedClipId === clip.id}
                      onSelect={() => setSelectedClipId(clip.id)}
                      onEdit={() => setEditingClipId(clip.id)}
                      onDragStart={(e) => handleDragStart(e, clip.id)}
                      onDragOver={handleDragOver}
                      onDrop={(e) => handleDrop(e, clip.id)}
                      isDragged={draggedClipId === clip.id}
                    />
                  ))}
                </div>
              </React.Fragment>
            ))}
          </>
        ) : (
          // Single track view: show clips from selected track only
          <>
            {displayClips.map((clip) => (
              <SequenceClipCard
                key={clip.id}
                clip={clip}
                isSelected={selectedClipId === clip.id}
                onSelect={() => setSelectedClipId(clip.id)}
                onEdit={() => setEditingClipId(clip.id)}
                onDragStart={(e) => handleDragStart(e, clip.id)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, clip.id)}
                isDragged={draggedClipId === clip.id}
              />
            ))}
          </>
        )}

        {/* Drop zone for adding clips at the end if needed */}
        <div
          className="shrink-0 w-12 h-full flex items-center justify-center text-muted-foreground/20 italic text-xs border-2 border-dashed border-muted/5 rounded-lg"
          onDragOver={handleDragOver}
          onDrop={(e) => {
            e.preventDefault();
            // const sourceId = e.dataTransfer.getData('clipId');
            // Logic for dropping at the end...
          }}
        >
          ...
        </div>
      </div>

      <ClipEditModal
        clipId={editingClipId}
        open={!!editingClipId}
        onOpenChange={(open) => !open && setEditingClipId(null)}
      />
    </div>
  );
}
