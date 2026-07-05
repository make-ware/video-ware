'use client';

import { useCallback } from 'react';
import Link from 'next/link';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  CheckCircle2,
  ChevronRight,
  Clock,
  Download,
  FileVideo,
  Film,
  Loader2,
  Play,
  XCircle,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import pb from '@/lib/pocketbase-client';
import type { File, Timeline, TimelineRender } from '@project/shared';

export type OverviewRender = TimelineRender & {
  expand?: { FileRef?: File };
};

interface TimelineOverviewCardProps {
  timeline: Timeline;
  renders: OverviewRender[];
  workspaceId: string;
}

function formatFileSize(bytes: number): string {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0) return '0:00';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = m.toString().padStart(h > 0 ? 2 : 1, '0');
  const ss = s.toString().padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function renderStatusBadge(status?: string) {
  switch (status) {
    case 'success':
      return (
        <Badge variant="default" className="gap-1">
          <CheckCircle2 className="h-3 w-3" />
          Ready
        </Badge>
      );
    case 'running':
      return (
        <Badge variant="secondary" className="gap-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          Rendering
        </Badge>
      );
    case 'failed':
      return (
        <Badge variant="destructive" className="gap-1">
          <XCircle className="h-3 w-3" />
          Failed
        </Badge>
      );
    case 'canceled':
      return <Badge variant="outline">Canceled</Badge>;
    default:
      return (
        <Badge variant="secondary" className="gap-1">
          <Clock className="h-3 w-3" />
          Queued
        </Badge>
      );
  }
}

export function TimelineOverviewCard({
  timeline,
  renders,
  workspaceId,
}: TimelineOverviewCardProps) {
  const editorHref = `/ws/${workspaceId}/timelines/${timeline.id}`;
  const rendersHref = `${editorHref}/renders`;

  // Open the rendered video in a new tab so it can be reviewed in-browser.
  const handleView = useCallback((render: OverviewRender) => {
    const file = render.expand?.FileRef;
    if (!file?.file) {
      toast.error('Render output not available');
      return;
    }
    window.open(pb.files.getURL(file, file.file), '_blank', 'noopener');
  }, []);

  // Fetch as a blob to force a download instead of navigating to the file.
  const handleDownload = useCallback(async (render: OverviewRender) => {
    const file = render.expand?.FileRef;
    if (!file?.file) {
      toast.error('File not available for download');
      return;
    }

    try {
      const fileUrl = pb.files.getURL(file, file.file);
      const response = await fetch(fileUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch file: ${response.statusText}`);
      }

      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = file.name || `render-${render.id}.mp4`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      window.URL.revokeObjectURL(blobUrl);
      toast.success('Download started');
    } catch (err) {
      console.error('Failed to download file:', err);
      toast.error('Failed to download file');
    }
  }, []);

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              <Film className="h-5 w-5 shrink-0 text-muted-foreground" />
              <span className="truncate">{timeline.name}</span>
            </CardTitle>
            <CardDescription className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                {formatDistanceToNow(new Date(timeline.updated), {
                  addSuffix: true,
                })}
              </span>
              <span>{formatDuration(timeline.duration)}</span>
              {timeline.orientation && (
                <Badge variant="outline" className="capitalize">
                  {timeline.orientation}
                </Badge>
              )}
            </CardDescription>
          </div>
          <Button asChild size="sm" className="shrink-0">
            <Link href={editorHref}>
              <Play className="h-4 w-4 mr-1.5" />
              View
            </Link>
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex-1">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Recent renders
          </span>
          {renders.length > 0 && (
            <Link
              href={rendersHref}
              className="flex items-center text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              All renders
              <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>

        {renders.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-md border border-dashed py-6 text-center">
            <FileVideo className="mb-1.5 h-6 w-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No renders yet</p>
          </div>
        ) : (
          <ul className="divide-y">
            {renders.map((render) => {
              const file = render.expand?.FileRef;
              const rawStatus = Array.isArray(render.status)
                ? render.status[0]
                : render.status;
              // A populated FileRef blob is the source of truth for
              // "downloadable"; legacy renders have an empty status, so treat
              // an empty status as completed when the output file is present.
              const hasFile = !!file?.file;
              const status = rawStatus || (hasFile ? 'success' : rawStatus);

              return (
                <li key={render.id} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">
                        v{render.version}
                      </span>
                      {renderStatusBadge(status)}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <span>
                        {formatDistanceToNow(new Date(render.created), {
                          addSuffix: true,
                        })}
                      </span>
                      {hasFile && file && (
                        <>
                          <span>•</span>
                          <span>{formatFileSize(file.size || 0)}</span>
                        </>
                      )}
                    </div>
                  </div>
                  {hasFile && (
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleView(render)}
                        title="View render"
                      >
                        <Play className="h-4 w-4" />
                        <span className="sr-only">View render</span>
                      </Button>
                      <Button
                        variant="secondary"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleDownload(render)}
                        title="Download render"
                      >
                        <Download className="h-4 w-4" />
                        <span className="sr-only">Download render</span>
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
