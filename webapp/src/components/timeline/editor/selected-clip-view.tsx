'use client';

import React, { useMemo, useState } from 'react';
import { useTimeline } from '@/hooks/use-timeline';
import { cn } from '@/lib/utils';
import {
  Pencil,
  Trash2,
  AlertTriangle,
  Film,
  Type,
  MousePointerClick,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SpriteAnimator } from '@/components/sprite/sprite-animator';
import { ClipEditorModal } from '@/components/clip/clip-editor-modal';
import { CaptionEditorModal } from '@/components/captions';
import type { ExpandedTimelineClip } from '@/types/expanded-types';
import type { Caption, TimelineClip } from '@project/shared';

function formatTime(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds - mins * 60;
  return `${mins}:${secs.toFixed(1).padStart(4, '0')}`;
}

interface DetailItemProps {
  label: string;
  value: string;
}

function DetailItem({ label, value }: DetailItemProps) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/60">
        {label}
      </span>
      <span className="text-xs font-mono truncate">{value}</span>
    </div>
  );
}

export function SelectedClipView() {
  const {
    timeline,
    selectedClipId,
    selectedClipIds,
    tracks,
    updateClip,
    removeClip,
    refreshTimeline,
  } = useTimeline();

  const [isHovering, setIsHovering] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const clip = useMemo(
    () => timeline?.clips.find((c) => c.id === selectedClipId),
    [timeline, selectedClipId]
  );

  const track = useMemo(
    () => tracks.find((t) => t.id === clip?.TimelineTrackRef),
    [tracks, clip]
  );

  // Effective position on the timeline: absolute if timelineStart is set,
  // otherwise sequential after preceding clips on the same track.
  const effectiveTimelineStart = useMemo(() => {
    if (!clip || !timeline) return 0;
    if (clip.timelineStart !== undefined && clip.timelineStart !== null) {
      return clip.timelineStart;
    }
    return timeline.clips
      .filter(
        (c) =>
          c.TimelineTrackRef === clip.TimelineTrackRef && c.order < clip.order
      )
      .reduce((sum, c) => sum + (c.end - c.start), 0);
  }, [clip, timeline]);

  if (!timeline) return null;

  if (!clip) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 w-full bg-background/30 rounded-lg h-48 lg:h-40 text-muted-foreground/60">
        <MousePointerClick className="h-6 w-6" />
        <span className="text-xs">
          Select a clip in the timeline to view its details
        </span>
      </div>
    );
  }

  const isCaption = !!clip.CaptionRef;
  const caption = (clip as TimelineClip & { expand?: { CaptionRef?: Caption } })
    .expand?.CaptionRef;
  const mediaMissing = !isCaption && clip.meta?.mediaMissing === true;
  const media = clip.expand?.MediaRef;
  const mediaName = isCaption
    ? caption?.name || caption?.text || 'Caption'
    : mediaMissing
      ? 'Media Deleted'
      : clip.expand?.MediaRef?.expand?.UploadRef?.name || 'Clip';
  const displayTitle = clip.meta?.title || mediaName;
  const clipColor = mediaMissing
    ? 'bg-destructive/60'
    : clip.meta?.color || (isCaption ? 'bg-purple-600/80' : 'bg-blue-600/80');
  const clipDuration = clip.end - clip.start;

  return (
    <div className="flex w-full bg-background/30 rounded-lg overflow-hidden h-48 lg:h-40">
      {/* Thumbnail */}
      <div
        className="relative shrink-0 h-full aspect-video bg-muted/30 border-r border-border/50 overflow-hidden"
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
      >
        {isCaption ? (
          <div className="flex items-center justify-center h-full bg-purple-600/10">
            <Type className="h-10 w-10 text-purple-400/40" />
          </div>
        ) : mediaMissing ? (
          <div className="flex items-center justify-center h-full bg-destructive/10">
            <AlertTriangle className="h-10 w-10 text-destructive/40" />
          </div>
        ) : media ? (
          <SpriteAnimator
            media={media}
            start={clip.start}
            end={clip.end}
            isHovering={isHovering}
            fallbackIcon={
              <div className="flex items-center justify-center h-full text-muted-foreground/20">
                <Film className="h-10 w-10" />
              </div>
            }
          />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground/20">
            <Film className="h-10 w-10" />
          </div>
        )}
      </div>

      {/* Details */}
      <div className="flex-1 min-w-0 flex flex-col justify-between p-3 lg:p-4">
        <div className="flex items-start justify-between gap-2 min-w-0">
          <div className="flex flex-col gap-0.5 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <div
                className={cn('w-2.5 h-2.5 rounded-full shrink-0', clipColor)}
              />
              <h4 className="text-sm font-semibold truncate">{displayTitle}</h4>
              {selectedClipIds.size > 1 && (
                <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                  +{selectedClipIds.size - 1} more selected
                </span>
              )}
            </div>
            <span className="text-xs text-muted-foreground truncate">
              {isCaption ? caption?.text || 'Caption' : mediaName}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="default"
              size="sm"
              className="h-8 px-2 lg:px-3"
              onClick={() => setIsEditing(true)}
            >
              <Pencil className="h-3.5 w-3.5 lg:mr-2" />
              <span className="hidden lg:inline">Edit Clip</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2 text-destructive hover:text-destructive"
              title="Remove clip from timeline"
              onClick={() => removeClip(clip.id)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-2">
          <DetailItem label="Duration" value={`${clipDuration.toFixed(1)}s`} />
          <DetailItem
            label="Timeline At"
            value={formatTime(effectiveTimelineStart)}
          />
          {!isCaption && (
            <DetailItem
              label="Source In / Out"
              value={`${formatTime(clip.start)} – ${formatTime(clip.end)}`}
            />
          )}
          <DetailItem
            label="Track"
            value={track ? `${track.name} (L${track.layer})` : 'Unassigned'}
          />
          <DetailItem
            label="Type"
            value={isCaption ? 'Caption' : 'Media Clip'}
          />
        </div>
      </div>

      {isEditing &&
        (isCaption ? (
          <CaptionEditorModal
            key={clip.id}
            open={isEditing}
            onOpenChange={(open) => {
              if (!open) setIsEditing(false);
            }}
            workspaceId={timeline.WorkspaceRef}
            caption={caption ?? null}
            onSaved={async () => {
              await refreshTimeline();
            }}
          />
        ) : (
          <ClipEditorModal
            key={clip.id}
            open={isEditing}
            onOpenChange={(open) => {
              if (!open) setIsEditing(false);
            }}
            mode="edit-timeline-clip"
            clip={clip as ExpandedTimelineClip}
            onSave={async (updates) => {
              await updateClip(clip.id, updates);
            }}
            onDelete={async () => {
              await removeClip(clip.id);
              setIsEditing(false);
            }}
          />
        ))}
    </div>
  );
}
