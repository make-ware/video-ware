'use client';

import type { Media } from '@project/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Empty,
  EmptyHeader,
  EmptyMedia as EmptyMediaIcon,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty';
import { Film, FolderOpen, Trash2, X } from 'lucide-react';
import { MediaCard } from './media-card';
import { useState } from 'react';

interface MediaGalleryProps {
  media: Media[];
  isLoading?: boolean;
  onMediaClick?: (media: Media) => void;
  className?: string;
  directoryFilter?: string | null;
  // Multi-select props
  selectedIds?: Set<string>;
  onSelectionClick?: (mediaId: string, e: React.MouseEvent) => void;
  onSelectAll?: () => void;
  onClearSelection?: () => void;
  onBulkDelete?: () => Promise<void>;
  isDeleting?: boolean;
}

export function MediaGallery({
  media,
  isLoading = false,
  onMediaClick,
  className,
  directoryFilter,
  selectedIds,
  onSelectionClick,
  onSelectAll,
  onClearSelection,
  onBulkDelete,
  isDeleting = false,
}: MediaGalleryProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const selectionCount = selectedIds?.size ?? 0;
  const hasSelection = selectionCount > 0;

  const handleConfirmDelete = async () => {
    if (onBulkDelete) {
      await onBulkDelete();
    }
    setDeleteDialogOpen(false);
  };

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader>
          <Skeleton className="h-6 w-32" />
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-48 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Media</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {selectionCount} media{' '}
              {selectionCount === 1 ? 'item' : 'items'}? This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Card className={className}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <span>Media Library</span>
              <Badge variant="secondary">{media.length}</Badge>
            </CardTitle>

            {/* Bulk action toolbar */}
            {hasSelection && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {selectionCount} selected
                </span>
                {onSelectAll && (
                  <Button variant="outline" size="sm" onClick={onSelectAll}>
                    Select All
                  </Button>
                )}
                {onClearSelection && (
                  <Button variant="ghost" size="sm" onClick={onClearSelection}>
                    <X className="h-4 w-4 mr-1" />
                    Clear
                  </Button>
                )}
                {onBulkDelete && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setDeleteDialogOpen(true)}
                    disabled={isDeleting}
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    Delete
                  </Button>
                )}
              </div>
            )}
          </div>
        </CardHeader>

        <CardContent>
          {media.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMediaIcon variant="icon">
                  {directoryFilter ? (
                    <FolderOpen className="h-6 w-6" />
                  ) : (
                    <Film className="h-6 w-6" />
                  )}
                </EmptyMediaIcon>
                <EmptyTitle>
                  {directoryFilter ? 'This folder is empty' : 'No media yet'}
                </EmptyTitle>
                <EmptyDescription>
                  {directoryFilter
                    ? 'Upload files to this folder or move existing media here'
                    : 'Upload videos to see them in your media library'}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {media.map((item) => (
                <MediaCard
                  key={item.id}
                  media={item}
                  onClick={onMediaClick ? () => onMediaClick(item) : undefined}
                  isSelected={selectedIds?.has(item.id) ?? false}
                  showSelectionIndicator={hasSelection}
                  onSelectionClick={
                    onSelectionClick
                      ? (e) => onSelectionClick(item.id, e)
                      : undefined
                  }
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
