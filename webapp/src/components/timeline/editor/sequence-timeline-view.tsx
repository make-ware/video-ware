'use client';

import React, { useState, useMemo, useRef } from 'react';
import { useTimeline } from '@/hooks/use-timeline';
import { cn } from '@/lib/utils';
import { Pencil, GripVertical, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ClipEditorModal } from '@/components/clip/clip-editor-modal';
import { CaptionEditorModal } from '@/components/captions';
import type { ExpandedTimelineClip } from '@/types/expanded-types';
import {
  getClipTimelineDuration,
  type Caption,
  type TimelineClip,
} from '@project/shared';

const BLOCK_WIDTH = 160;
const ALL_TRACKS_VALUE = '__all__';

import { SpriteAnimator } from '@/components/sprite/sprite-animator';
import { Film, Type } from 'lucide-react';

interface SequenceClipCardProps {
  clip: TimelineClip;
  isSelected: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onEdit: () => void;
  /** Pointer-down on the grip handle — starts a reorder drag (mouse + touch) */
  onGripPointerDown: (e: React.PointerEvent) => void;
  isDragged: boolean;
  /** True while another card is being dragged over this one */
  isDropTarget: boolean;
}

function SequenceClipCard({
  clip,
  isSelected,
  onSelect,
  onEdit,
  onGripPointerDown,
  isDragged,
  isDropTarget,
}: SequenceClipCardProps) {
  const [isHovering, setIsHovering] = useState(false);
  const isCaption = !!clip.CaptionRef;
  const caption = (clip as TimelineClip & { expand?: { CaptionRef?: Caption } })
    .expand?.CaptionRef;
  const mediaMissing = !isCaption && clip.meta?.mediaMissing === true;
  const mediaName = isCaption
    ? caption?.name || caption?.text || 'Caption'
    : mediaMissing
      ? 'Media Deleted'
      : clip.expand?.MediaRef?.expand?.UploadRef?.name || 'Clip';
  const displayTitle = clip.meta?.title || mediaName;
  const clipColor = mediaMissing
    ? 'bg-destructive/60'
    : clip.meta?.color || (isCaption ? 'bg-purple-600/80' : 'bg-blue-600/80');
  const media = clip.expand?.MediaRef;

  return (
    <div
      data-clip-id={clip.id}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      onClick={(e) => onSelect(e)}
      className={cn(
        'relative shrink-0 flex flex-col justify-between p-3 rounded-lg border-2 transition-all cursor-pointer group overflow-hidden',
        isSelected
          ? 'border-primary shadow-lg ring-2 ring-primary/20 scale-105 z-10'
          : 'border-border bg-card hover:border-muted-foreground/50',
        isDragged && 'opacity-50',
        isDropTarget && 'border-primary ring-2 ring-primary/40',
        'h-[120px] lg:h-[100px]'
      )}
      style={{
        width: BLOCK_WIDTH,
      }}
    >
      {/* Background Sprite Animator */}
      <div className="absolute inset-0 z-0">
        {isCaption ? (
          <div className="flex items-center justify-center h-full bg-purple-600/10">
            <Type className="h-8 w-8 text-purple-400/40" />
          </div>
        ) : mediaMissing ? (
          <div className="flex items-center justify-center h-full bg-destructive/10">
            <AlertTriangle className="h-8 w-8 text-destructive/40" />
          </div>
        ) : media ? (
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

      {/* Grip handle: drag here to reorder (keeps the strip scrollable on touch) */}
      <div
        className="absolute top-1 right-0.5 h-8 w-8 flex items-center justify-center z-20 cursor-grab active:cursor-grabbing touch-none rounded-md hover:bg-background/60"
        onPointerDown={onGripPointerDown}
        onClick={(e) => e.stopPropagation()}
        title="Drag to reorder"
      >
        <GripVertical className="h-4 w-4 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />
      </div>

      <div className="flex flex-col gap-1 min-w-0 z-10">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          {getClipTimelineDuration(clip).toFixed(1)}s
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
          className="h-7 w-7 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity shadow-md"
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
  const {
    timeline,
    isClipSelected,
    handleClipSelect,
    reorderClips,
    tracks,
    updateClip,
    removeClip,
    refreshTimeline,
  } = useTimeline();

  const [editingClipId, setEditingClipId] = useState<string | null>(null);
  const editingClip = useMemo(
    () => timeline?.clips.find((c) => c.id === editingClipId),
    [timeline, editingClipId]
  );
  const [draggedClipId, setDraggedClipId] = useState<string | null>(null);
  const [dropTargetClipId, setDropTargetClipId] = useState<string | null>(null);
  const dragSourceRef = useRef<string | null>(null);
  const dropTargetRef = useRef<string | null>(null);
  const [selectedTrackFilter, setSelectedTrackFilter] =
    useState<string>(ALL_TRACKS_VALUE);

  // Sort tracks by layer (lowest to highest for display order) - hooks must run unconditionally
  const sortedTracks = useMemo(() => {
    return [...tracks].sort((a, b) => a.layer - b.layer);
  }, [tracks]);

  // Filter clips based on selected track
  const displayClips = useMemo(() => {
    if (!timeline) return [];
    if (selectedTrackFilter === ALL_TRACKS_VALUE) {
      // Show all clips, sorted by track layer then by order
      return [...timeline.clips].sort((a, b) => {
        const aTrack = tracks.find((t) => t.id === a.TimelineTrackRef);
        const bTrack = tracks.find((t) => t.id === b.TimelineTrackRef);
        const aLayer = aTrack?.layer ?? 0;
        const bLayer = bTrack?.layer ?? 0;

        if (aLayer !== bLayer) {
          return aLayer - bLayer;
        }
        return a.order - b.order;
      });
    }
    // Show only clips from selected track
    return timeline.clips
      .filter((c) => c.TimelineTrackRef === selectedTrackFilter)
      .sort((a, b) => a.order - b.order);
  }, [timeline, selectedTrackFilter, tracks]);

  // Group clips by track when showing all tracks
  const groupedClips = useMemo(() => {
    if (!timeline || selectedTrackFilter !== ALL_TRACKS_VALUE) {
      return null;
    }

    const groups: Array<{
      track: (typeof sortedTracks)[0] | null;
      clips: TimelineClip[];
    }> = [];

    sortedTracks.forEach((track) => {
      const trackClips = timeline.clips
        .filter((c) => c.TimelineTrackRef === track.id)
        .sort((a, b) => a.order - b.order);

      if (trackClips.length > 0) {
        groups.push({ track, clips: trackClips });
      }
    });

    // Add clips without a track assignment
    const unassignedClips = timeline.clips
      .filter(
        (c) =>
          !c.TimelineTrackRef ||
          !tracks.find((t) => t.id === c.TimelineTrackRef)
      )
      .sort((a, b) => a.order - b.order);

    if (unassignedClips.length > 0) {
      groups.push({ track: null, clips: unassignedClips });
    }

    return groups;
  }, [timeline, sortedTracks, tracks, selectedTrackFilter]);

  if (!timeline) return null;

  const moveClip = async (sourceId: string, targetId: string) => {
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
  };

  // Pointer-based reorder so it works with both mouse and touch. The grip
  // handle owns the gesture; the card under the pointer is the drop target.
  const handleGripPointerDown = (clipId: string) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragSourceRef.current = clipId;
    dropTargetRef.current = null;
    setDraggedClipId(clipId);

    const onMove = (ev: PointerEvent) => {
      const card = document
        .elementFromPoint(ev.clientX, ev.clientY)
        ?.closest('[data-clip-id]');
      const id = card?.getAttribute('data-clip-id') ?? null;
      const next = id === dragSourceRef.current ? null : id;
      dropTargetRef.current = next;
      setDropTargetClipId(next);
    };

    const onUp = async () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);

      const sourceId = dragSourceRef.current;
      const targetId = dropTargetRef.current;
      dragSourceRef.current = null;
      dropTargetRef.current = null;
      setDraggedClipId(null);
      setDropTargetClipId(null);

      if (sourceId && targetId && sourceId !== targetId) {
        try {
          await moveClip(sourceId, targetId);
        } catch (error) {
          console.error('Failed to reorder clips', error);
        }
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  return (
    <div className="flex flex-col w-full bg-background/30 rounded-lg overflow-hidden h-48 lg:h-40">
      {/* Track Selector */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border/50">
        <span className="text-xs font-medium text-muted-foreground">
          Track:
        </span>
        <Select
          value={selectedTrackFilter}
          onValueChange={setSelectedTrackFilter}
        >
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
                      isSelected={isClipSelected(clip.id)}
                      onSelect={(e) => handleClipSelect(clip.id, e)}
                      onEdit={() => setEditingClipId(clip.id)}
                      onGripPointerDown={handleGripPointerDown(clip.id)}
                      isDragged={draggedClipId === clip.id}
                      isDropTarget={dropTargetClipId === clip.id}
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
                isSelected={isClipSelected(clip.id)}
                onSelect={(e) => handleClipSelect(clip.id, e)}
                onEdit={() => setEditingClipId(clip.id)}
                onGripPointerDown={handleGripPointerDown(clip.id)}
                isDragged={draggedClipId === clip.id}
                isDropTarget={dropTargetClipId === clip.id}
              />
            ))}
          </>
        )}
      </div>

      {editingClip &&
        (editingClip.CaptionRef ? (
          <CaptionEditorModal
            key={editingClipId}
            open={!!editingClipId}
            onOpenChange={(open) => {
              if (!open) setEditingClipId(null);
            }}
            workspaceId={timeline.WorkspaceRef}
            caption={
              (
                editingClip as TimelineClip & {
                  expand?: { CaptionRef?: Caption };
                }
              ).expand?.CaptionRef ?? null
            }
            onSaved={async () => {
              await refreshTimeline();
            }}
          />
        ) : (
          <ClipEditorModal
            key={editingClipId}
            open={!!editingClipId}
            onOpenChange={(open) => {
              if (!open) setEditingClipId(null);
            }}
            mode="edit-timeline-clip"
            clip={editingClip as ExpandedTimelineClip}
            onSave={async (updates) => {
              await updateClip(editingClipId!, updates);
            }}
            onDelete={async () => {
              await removeClip(editingClipId!);
              setEditingClipId(null);
            }}
          />
        ))}
    </div>
  );
}
