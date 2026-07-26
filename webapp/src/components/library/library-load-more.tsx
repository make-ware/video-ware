'use client';

/**
 * The load-more footer and card skeleton shared by every library surface that
 * pages through a live infinite list (see hooks/use-live-infinite-list.ts).
 * Both the timeline workspace library and the media viewer's Clips tab render
 * these, so "Showing X of Y" reads identically in both places.
 */
import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Loader2 } from 'lucide-react';

interface LibraryLoadMoreProps {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  /** Rows currently in the cache; the "X" of "Showing X of Y". */
  loadedCount: number;
  /** Server-side total for the current filters; the "Y". */
  totalItems: number;
  onLoadMore: () => void;
}

export function LibraryLoadMore({
  hasNextPage,
  isFetchingNextPage,
  loadedCount,
  totalItems,
  onLoadMore,
}: LibraryLoadMoreProps) {
  if (!hasNextPage) return null;

  return (
    <div className="mt-4 pb-8 flex flex-col items-center gap-1.5">
      <Button
        variant="outline"
        size="sm"
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
      <span className="text-[10px] text-muted-foreground">
        Showing {loadedCount} of {totalItems}
      </span>
    </div>
  );
}

/** First-page placeholder for a library card (grid cell or list row). */
export function LibraryItemSkeleton() {
  return (
    <Card className="overflow-hidden w-full h-40">
      <CardContent className="p-2.5 h-full flex flex-col">
        <Skeleton className="w-full h-24 rounded mb-2 flex-shrink-0" />
        <div className="flex-1 flex flex-col gap-1 min-h-0 text-xs">
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-2.5 w-1/2" />
        </div>
      </CardContent>
    </Card>
  );
}
