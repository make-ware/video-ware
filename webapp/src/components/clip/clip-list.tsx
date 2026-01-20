'use client';

import type { Media, MediaClip } from '@project/shared';
import { ClipItem } from './clip-item';
import { cn } from '@/lib/utils';

interface ClipListProps {
  media: Media;
  clips: MediaClip[];
  activeClipId?: string;
  onClipSelect?: (clip: MediaClip) => void;
  onClipUpdate?: () => void;
  onClipDelete?: () => void;
  onInlineEdit?: (clipId: string) => void;
  className?: string;
}

export function ClipList({
  media,
  clips,
  activeClipId,
  onClipSelect,
  onClipUpdate,
  onClipDelete,
  onInlineEdit,
  className,
}: ClipListProps) {
  if (clips.length === 0) {
    return (
      <div className={cn('text-center py-8 text-muted-foreground', className)}>
        <p>No clips found for this media.</p>
        <p className="text-sm mt-2">Create a clip using the form above.</p>
      </div>
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      {clips.map((clip) => (
        <ClipItem
          key={clip.id}
          clip={clip}
          media={media}
          isActive={activeClipId === clip.id}
          onSelect={onClipSelect}
          onUpdate={onClipUpdate}
          onDelete={onClipDelete}
          onInlineEdit={onInlineEdit}
        />
      ))}
    </div>
  );
}
