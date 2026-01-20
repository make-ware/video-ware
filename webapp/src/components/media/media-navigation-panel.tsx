'use client';

import * as React from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { useMedia } from '@/hooks/use-media';
import { Button } from '@/components/ui/button';

interface MediaNavigationPanelProps {
  currentMediaId: string;
}

export function MediaNavigationPanel({
  currentMediaId,
}: MediaNavigationPanelProps) {
  const router = useRouter();
  const params = useParams();
  const workspaceId = params.workspaceId as string;
  const { media, isLoading } = useMedia();

  // Find current index
  const currentIndex = React.useMemo(() => {
    return media.findIndex((m) => m.id === currentMediaId);
  }, [media, currentMediaId]);

  const handlePrev = () => {
    if (currentIndex > 0) {
      router.push(`/ws/${workspaceId}/media/${media[currentIndex - 1].id}`);
    }
  };

  const handleNext = () => {
    if (currentIndex < media.length - 1) {
      router.push(`/ws/${workspaceId}/media/${media[currentIndex + 1].id}`);
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

  // Calculate current item number (1-based)
  const currentNumber = currentIndex !== -1 ? currentIndex + 1 : 0;
  const totalItems = media.length;

  return (
    <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50 w-full shadow-sm">
      <div className="flex items-center justify-between py-2 px-4">
        <Button
          variant="ghost"
          onClick={handlePrev}
          disabled={currentIndex <= 0}
          className="gap-2"
        >
          <ChevronLeft className="h-4 w-4" />
          Prev
        </Button>

        <span className="text-sm font-medium">
          {currentNumber} / {totalItems}
        </span>

        <Button
          variant="ghost"
          onClick={handleNext}
          disabled={currentIndex < 0 || currentIndex >= media.length - 1}
          className="gap-2"
        >
          Next
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
