'use client';

import * as React from 'react';
import { useRouter, useParams, usePathname } from 'next/navigation';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { useMediaNeighbors } from '@/hooks/use-media-neighbors';
import { Button } from '@/components/ui/button';

interface MediaNavigationPanelProps {
  currentMediaId: string;
}

export function MediaNavigationPanel({
  currentMediaId,
}: MediaNavigationPanelProps) {
  const router = useRouter();
  const params = useParams();
  const pathname = usePathname();
  const workspaceId = params.workspaceId as string;
  const { prevId, nextId, position, totalItems, isLoading } = useMediaNeighbors(
    workspaceId,
    currentMediaId
  );

  // Capture the subpage suffix after the current media id (e.g.
  // "/labels/speakers", "/details", or "") so it can be preserved when
  // tabbing between media items.
  const subPath = React.useMemo(() => {
    const basePath = `/ws/${workspaceId}/media/${currentMediaId}`;
    return pathname.startsWith(basePath) ? pathname.slice(basePath.length) : '';
  }, [pathname, workspaceId, currentMediaId]);

  const handlePrev = () => {
    if (prevId) {
      router.push(`/ws/${workspaceId}/media/${prevId}${subPath}`);
    }
  };

  const handleNext = () => {
    if (nextId) {
      router.push(`/ws/${workspaceId}/media/${nextId}${subPath}`);
    }
  };

  if (isLoading) {
    return (
      <div className="border-b bg-background/95 backdrop-blur py-2">
        <div className="container flex items-center justify-center h-10">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50 w-full shadow-sm">
      <div className="flex items-center justify-between py-2 px-4">
        <Button
          variant="ghost"
          onClick={handlePrev}
          disabled={!prevId}
          className="gap-2"
        >
          <ChevronLeft className="h-4 w-4" />
          Prev
        </Button>

        <span className="text-sm font-medium">
          {position} / {totalItems}
        </span>

        <Button
          variant="ghost"
          onClick={handleNext}
          disabled={!nextId}
          className="gap-2"
        >
          Next
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
