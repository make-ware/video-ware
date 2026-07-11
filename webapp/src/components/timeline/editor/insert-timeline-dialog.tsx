'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { Layers, Film } from 'lucide-react';
import { useTimeline } from '@/hooks/use-timeline';
import { useWorkspace } from '@/hooks/use-workspace';
import { TimelineService } from '@/services/timeline';
import pb from '@/lib/pocketbase-client';
import type { Timeline } from '@project/shared';
import { toast } from 'sonner';

interface InsertTimelineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Pick another timeline in the workspace and insert it into the current
 * timeline as a nested-timeline clip. The inserted timeline plays as a
 * single clip that can be trimmed but not edited in place; the service
 * rejects picks that would create a circular reference.
 */
export function InsertTimelineDialog({
  open,
  onOpenChange,
}: InsertTimelineDialogProps) {
  const { timeline, addTimelineClip } = useTimeline();
  const { currentWorkspace } = useWorkspace();
  const [timelines, setTimelines] = useState<Timeline[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [insertingId, setInsertingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!open || !currentWorkspace) return;
    let cancelled = false;
    setIsLoading(true);
    new TimelineService(pb)
      .getTimelinesByWorkspace(currentWorkspace.id)
      .then((items) => {
        if (!cancelled) setTimelines(items);
      })
      .catch(() => {
        if (!cancelled) toast.error('Failed to load timelines');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, currentWorkspace]);

  const candidates = useMemo(() => {
    const query = search.trim().toLowerCase();
    return timelines
      .filter((t) => t.id !== timeline?.id)
      .filter((t) =>
        query ? (t.label || t.name || '').toLowerCase().includes(query) : true
      );
  }, [timelines, timeline, search]);

  const handleInsert = async (sourceTimeline: Timeline) => {
    setInsertingId(sourceTimeline.id);
    try {
      await addTimelineClip(sourceTimeline.id);
      toast.success(
        `Inserted "${sourceTimeline.label || sourceTimeline.name}"`
      );
      onOpenChange(false);
      setSearch('');
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to insert timeline'
      );
    } finally {
      setInsertingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Insert Timeline</DialogTitle>
          <DialogDescription>
            Add another timeline as a single clip. It can be trimmed on the
            track, but its contents are edited in the source timeline.
          </DialogDescription>
        </DialogHeader>

        <Input
          placeholder="Search timelines…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />

        <div className="max-h-72 overflow-y-auto flex flex-col gap-1">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <LoadingSpinner />
            </div>
          ) : candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              {search
                ? 'No timelines match your search'
                : 'No other timelines in this workspace'}
            </p>
          ) : (
            candidates.map((t) => (
              <Button
                key={t.id}
                variant="ghost"
                className="justify-start h-auto py-2"
                disabled={insertingId !== null}
                onClick={() => handleInsert(t)}
              >
                {insertingId === t.id ? (
                  <LoadingSpinner size="sm" className="mr-2" />
                ) : (
                  <Layers className="h-4 w-4 mr-2 shrink-0" />
                )}
                <span className="flex flex-col items-start min-w-0">
                  <span className="truncate max-w-full">
                    {t.label || t.name}
                  </span>
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Film className="h-3 w-3" />
                    {t.orientation === 'portrait' ? 'Portrait' : 'Landscape'}
                  </span>
                </span>
              </Button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
