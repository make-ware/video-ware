'use client';

import React from 'react';
import type { Media } from '@project/shared';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';
import { LibraryItemCard } from './library-item-card';
import { LibraryLoadMore, LibraryItemSkeleton } from './library-load-more';
import type { ExpandedMediaClip, ExpandedMedia } from '@/types/expanded-types';
import type { LibraryItem } from './types';

interface MediaClipsLibraryProps {
  media: Media | ExpandedMedia;
  clips: ExpandedMediaClip[];
  activeClipId?: string;
  onClipSelect?: (clip: ExpandedMediaClip) => void;
  onClipUpdate?: () => void;
  onClipDelete?: () => void;
  onInlineEdit?: (clipId: string) => void;
  className?: string;
  // Live infinite list envelope (see hooks/use-clip-list.ts).
  isLoading?: boolean;
  error?: string | null;
  /** Server-side total for the current filters; the "Y" of "Showing X of Y". */
  totalItems?: number;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  onLoadMore?: () => void;
  /** Drives the "try adjusting your search" empty-state hint. */
  hasSearch?: boolean;
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
  isLoading = false,
  error = null,
  totalItems = 0,
  hasNextPage = false,
  isFetchingNextPage = false,
  onLoadMore,
  hasSearch = false,
}: MediaClipsLibraryProps) {
  if (isLoading && clips.length === 0) {
    return (
      <div className={cn('space-y-3', className)}>
        {Array.from({ length: 4 }).map((_, i) => (
          <LibraryItemSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive" className={className}>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      {clips.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <p>No clips found for this media.</p>
          <p className="text-sm mt-2">
            {hasSearch
              ? 'Try adjusting your search or filters.'
              : 'Create a clip using the form above.'}
          </p>
        </div>
      ) : (
        <>
          {clips.map((clip) => {
            const item: LibraryItem = {
              kind: 'clip',
              id: clip.id,
              clip: {
                ...clip,
                // Deliberately overwrites the fetched MediaRef expand: the
                // page's `media` also carries proxy/audio/filmstrip refs that
                // CLIP_LIST_EXPAND omits, so the richer object renders better.
                expand: { MediaRef: media as ExpandedMedia },
              },
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
          })}
          {onLoadMore && (
            <LibraryLoadMore
              hasNextPage={hasNextPage}
              isFetchingNextPage={isFetchingNextPage}
              loadedCount={clips.length}
              totalItems={totalItems}
              onLoadMore={onLoadMore}
            />
          )}
        </>
      )}
    </div>
  );
}
