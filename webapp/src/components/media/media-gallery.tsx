'use client';

import type { Media } from '@project/shared';
import { isCuratedTag } from '@project/shared';
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DirectorySelector } from '@/components/uploads/directory-selector';
import { EntityPicker } from '@/components/labels/entity/entity-picker';
import {
  Film,
  FolderInput,
  FolderOpen,
  Loader2,
  Search,
  Tag,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import { MediaCard } from './media-card';
import { MediaTypeIcon, getMediaTypeLabel } from './media-type-icon';
import { useMediaEntityLinks } from '@/hooks/use-media-entities';
import { useWorkspaceEntities } from '@/hooks/use-entities';
import { useMemo, useState } from 'react';

interface MediaGalleryProps {
  media: Media[];
  isLoading?: boolean;
  onMediaClick?: (media: Media) => void;
  className?: string;
  directoryFilter?: string | null;
  mediaTypeFilter?: string;
  /** True when an entity filter is active (drives the empty state copy). */
  entityFilterActive?: boolean;
  /** True when a search query is active (drives the empty state copy). */
  searchActive?: boolean;
  processingMedia?: Map<string, string>;
  // Pagination (load-more) props
  /** Server-side total; the header badge falls back to media.length. */
  totalItems?: number;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  onLoadMore?: () => void;
  // Multi-select props
  selectedIds?: Set<string>;
  onSelectionClick?: (mediaId: string, e: React.MouseEvent) => void;
  onSelectAll?: () => void;
  onClearSelection?: () => void;
  onBulkDelete?: () => Promise<void>;
  onBulkMove?: (directoryId: string | null) => Promise<void>;
  onBulkTag?: (entityId: string) => Promise<void>;
  onBulkUntag?: (entityId: string) => Promise<void>;
  isDeleting?: boolean;
  isMoving?: boolean;
  isTagging?: boolean;
  workspaceId?: string;
}

export function MediaGallery({
  media,
  isLoading = false,
  onMediaClick,
  className,
  directoryFilter,
  mediaTypeFilter,
  entityFilterActive = false,
  searchActive = false,
  processingMedia,
  totalItems,
  hasNextPage = false,
  isFetchingNextPage = false,
  onLoadMore,
  selectedIds,
  onSelectionClick,
  onSelectAll,
  onClearSelection,
  onBulkDelete,
  onBulkMove,
  onBulkTag,
  onBulkUntag,
  isDeleting = false,
  isMoving = false,
  isTagging = false,
  workspaceId,
}: MediaGalleryProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [movePopoverOpen, setMovePopoverOpen] = useState(false);
  const selectionCount = selectedIds?.size ?? 0;
  const hasSelection = selectionCount > 0;

  // Entity chips for the loaded window: one MediaEntities request per page,
  // colored by the entity's position in the workspace list like the label UIs.
  const mediaIds = useMemo(() => media.map((item) => item.id), [media]);
  const { linksByMediaId } = useMediaEntityLinks(mediaIds);
  const { entities } = useWorkspaceEntities(workspaceId ?? '');
  const colorIndexById = useMemo(() => {
    const map = new Map<string, number>();
    entities.forEach((entity, index) => map.set(entity.id, index));
    return map;
  }, [entities]);

  // Only curated tags are removable from here — a detected appearance is a
  // label link, unlinked from the label inspector, not from the gallery.
  const removableTags = useMemo(() => {
    if (!selectedIds || !linksByMediaId) return [];
    const counts = new Map<string, { name: string; count: number }>();
    for (const mediaId of selectedIds) {
      for (const link of linksByMediaId[mediaId] ?? []) {
        if (!isCuratedTag(link)) continue;
        const entry = counts.get(link.id);
        if (entry) entry.count += 1;
        else counts.set(link.id, { name: link.name, count: 1 });
      }
    }
    return [...counts.entries()]
      .map(([id, entry]) => ({ id, ...entry }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [selectedIds, linksByMediaId]);

  const typeFilterActive = !!mediaTypeFilter && mediaTypeFilter !== 'all';
  const typeFilterLabel = getMediaTypeLabel(mediaTypeFilter);

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
              <Badge variant="secondary">{totalItems ?? media.length}</Badge>
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
                {onBulkTag && workspaceId && (
                  <EntityPicker
                    workspaceId={workspaceId}
                    // Always "add" mode: a pick tags the selection, and the
                    // trigger goes back to its placeholder afterwards.
                    value={undefined}
                    onChange={(entityId) => {
                      if (entityId) void onBulkTag(entityId);
                    }}
                    disabled={isTagging}
                    placeholder="Tag entity…"
                    className="h-8 w-[150px] text-xs"
                  />
                )}
                {onBulkUntag && removableTags.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" disabled={isTagging}>
                        <Tag className="h-4 w-4 mr-1" />
                        Remove tag
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuLabel className="text-xs font-medium">
                        Remove from {selectionCount}{' '}
                        {selectionCount === 1 ? 'item' : 'items'}
                      </DropdownMenuLabel>
                      {removableTags.map((tag) => (
                        <DropdownMenuItem
                          key={tag.id}
                          onSelect={() => void onBulkUntag(tag.id)}
                        >
                          <span className="truncate">{tag.name}</span>
                          <span className="ml-auto text-xs text-muted-foreground">
                            {tag.count}/{selectionCount}
                          </span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                {onBulkMove && workspaceId && (
                  <Popover
                    open={movePopoverOpen}
                    onOpenChange={setMovePopoverOpen}
                  >
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" disabled={isMoving}>
                        <FolderInput className="h-4 w-4 mr-1" />
                        {isMoving ? 'Moving...' : 'Move'}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-72 p-3" align="end">
                      <p className="text-xs font-medium mb-2">
                        Move {selectionCount}{' '}
                        {selectionCount === 1 ? 'item' : 'items'} to folder
                      </p>
                      <DirectorySelector
                        workspaceId={workspaceId}
                        onDirectoryChange={async (dirId) => {
                          await onBulkMove(dirId);
                          setMovePopoverOpen(false);
                        }}
                      />
                    </PopoverContent>
                  </Popover>
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
                  {searchActive ? (
                    <Search className="h-6 w-6" />
                  ) : entityFilterActive ? (
                    <UserRound className="h-6 w-6" />
                  ) : typeFilterActive ? (
                    <MediaTypeIcon
                      mediaType={mediaTypeFilter}
                      className="h-6 w-6"
                    />
                  ) : directoryFilter ? (
                    <FolderOpen className="h-6 w-6" />
                  ) : (
                    <Film className="h-6 w-6" />
                  )}
                </EmptyMediaIcon>
                <EmptyTitle>
                  {searchActive
                    ? 'No matches for your search'
                    : entityFilterActive
                      ? 'No media for this entity'
                      : typeFilterActive
                        ? `No ${typeFilterLabel.toLowerCase()} here`
                        : directoryFilter
                          ? 'This folder is empty'
                          : 'No media yet'}
                </EmptyTitle>
                <EmptyDescription>
                  {searchActive
                    ? 'Try a different search term or clear the filters'
                    : entityFilterActive
                      ? 'Nothing is tagged with it, and no label track is linked to it yet'
                      : typeFilterActive
                        ? 'Try a different media type or upload more files'
                        : directoryFilter
                          ? 'Upload files to this folder or move existing media here'
                          : 'Upload videos to see them in your media library'}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {media.map((item) => (
                  <MediaCard
                    key={item.id}
                    media={item}
                    onClick={
                      onMediaClick ? () => onMediaClick(item) : undefined
                    }
                    isSelected={selectedIds?.has(item.id) ?? false}
                    isProcessing={processingMedia?.has(item.id) ?? false}
                    processingLabel={processingMedia?.get(item.id)}
                    showSelectionIndicator={hasSelection}
                    onSelectionClick={
                      onSelectionClick
                        ? (e) => onSelectionClick(item.id, e)
                        : undefined
                    }
                    entityLinks={linksByMediaId?.[item.id]}
                    colorIndexById={colorIndexById}
                  />
                ))}
              </div>
              {hasNextPage && onLoadMore && (
                <div className="mt-6 flex flex-col items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={onLoadMore}
                    disabled={isFetchingNextPage}
                  >
                    {isFetchingNextPage ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Loading...
                      </>
                    ) : (
                      'Load More'
                    )}
                  </Button>
                  {totalItems !== undefined && (
                    <span className="text-xs text-muted-foreground">
                      Showing {media.length} of {totalItems}
                    </span>
                  )}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}
