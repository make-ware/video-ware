'use client';

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
  Trash2,
  XCircle,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import pb from '@/lib/pocketbase-client';
import type { Timeline } from '@project/shared';
import type { OverviewRender } from '@/hooks/use-timelines-overview';

interface TimelineOverviewCardProps {
  timeline: Timeline;
  /** The timeline's newest render, if it has been rendered at all. */
  latestRender?: OverviewRender;
  workspaceId: string;
  /** When provided, shows a delete button; confirmation is the caller's job. */
  onDelete?: (timeline: Timeline) => void;
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
  latestRender,
  workspaceId,
  onDelete,
}: TimelineOverviewCardProps) {
  const editorHref = `/ws/${workspaceId}/timelines/${timeline.id}`;
  const rendersHref = `${editorHref}/renders`;

  const file = latestRender?.expand?.FileRef;
  const rawStatus = Array.isArray(latestRender?.status)
    ? latestRender.status[0]
    : latestRender?.status;
  // A populated FileRef blob is the source of truth for "downloadable";
  // legacy renders have an empty status, so treat an empty status as
  // completed when the output file is present.
  const hasFile = !!file?.file;
  const status = rawStatus || (hasFile ? 'success' : rawStatus);
  // Plain <a download> anchor pointing straight at the PocketBase file URL —
  // a fetch+blob handler stalls the tab on large renders while the whole file
  // buffers into memory first.
  const downloadUrl =
    file && file.file
      ? pb.files.getURL(file, file.file, { download: true })
      : undefined;

  return (
    <Card className="flex flex-col">
      <CardHeader>
        {/* Phones stack the title block above the actions; from sm up the
            actions sit on the title's right. */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-2">
            <Film className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <CardTitle className="truncate">{timeline.name}</CardTitle>
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
          </div>
          <div className="flex items-center gap-1.5 sm:shrink-0">
            <Button asChild size="sm" className="flex-1 sm:flex-none">
              <Link href={editorHref}>
                <Play className="h-4 w-4 mr-1.5" />
                View
              </Link>
            </Button>
            {onDelete && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => onDelete(timeline)}
                title="Delete timeline"
              >
                <Trash2 className="h-4 w-4" />
                <span className="sr-only">Delete timeline</span>
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Latest render
          </span>
          {latestRender && (
            <Link
              href={rendersHref}
              className="flex shrink-0 items-center text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              All renders
              <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>

        {!latestRender ? (
          <div className="flex flex-col items-center justify-center rounded-md border border-dashed py-6 text-center">
            <FileVideo className="mb-1.5 h-6 w-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No renders yet</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">
                  v{latestRender.version}
                </span>
                {renderStatusBadge(status)}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                <span>
                  {formatDistanceToNow(new Date(latestRender.created), {
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
            {hasFile && downloadUrl && (
              /* Labelled buttons split the row on phones (icon-only targets
                 read as ambiguous there) and shrink to their labels from sm. */
              <div className="flex items-center gap-1.5 sm:shrink-0">
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="flex-1 sm:flex-none"
                >
                  <Link href={`${rendersHref}/${latestRender.id}`}>
                    <Play className="h-4 w-4 mr-1.5" />
                    Watch
                  </Link>
                </Button>
                <Button
                  asChild
                  variant="secondary"
                  size="sm"
                  className="flex-1 sm:flex-none"
                >
                  <a
                    href={downloadUrl}
                    download={file.name || `render-${latestRender.id}.mp4`}
                  >
                    <Download className="h-4 w-4 mr-1.5" />
                    Download
                  </a>
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
