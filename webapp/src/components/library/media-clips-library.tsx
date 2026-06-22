'use client';

import React from 'react';
import type { Media, MediaClip } from '@project/shared';
import { cn } from '@/lib/utils';
import { LibraryItemCard } from './library-item-card';
import type { ExpandedMediaClip, ExpandedMedia } from '@/types/expanded-types';
import type { LibraryItem } from './types';

interface MediaClipsLibraryProps {
  media: Media | ExpandedMedia;
  clips: MediaClip[];
  activeClipId?: string;
  onClipSelect?: (clip: MediaClip) => void;
  onClipUpdate?: () => void;
  onClipDelete?: () => void;
  onInlineEdit?: (clipId: string) => void;
  className?: string;
}

export function MediaClipsLibrary({
  media,
  clips,
  activeClipId,
  onClipSelect,
  onClipUpdate,
  onClipDelete,
  onInlineEdit,
  className,
}: MediaClipsLibraryProps) {
  return (
    <div className={cn('space-y-3', className)}>
      {clips.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <p>No clips found for this media.</p>
          <p className="text-sm mt-2">Create a clip using the form above.</p>
        </div>
      ) : (
        clips.map((clip) => {
          const item: LibraryItem = {
            kind: 'clip',
            id: clip.id,
            clip: {
              ...clip,
              expand: { MediaRef: media as ExpandedMedia },
            } as ExpandedMediaClip,
          };

          return (
            <LibraryItemCard
              key={clip.id}
              item={item}
              surface="media-details"
              isActive={activeClipId === clip.id}
              onSelect={onClipSelect ? () => onClipSelect(clip) : undefined}
              onClipUpdate={onClipUpdate}
              onClipDelete={onClipDelete}
              onInlineEditClip={onInlineEdit}
            />
          );
        })
      )}
    </div>
  );
}
