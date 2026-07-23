'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspace } from '@/hooks/use-workspace';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  AlertCircle,
  ArrowLeft,
  Download,
  FileVideo,
  Loader2,
} from 'lucide-react';
import type { RecordSubscription } from 'pocketbase';
import pb from '@/lib/pocketbase-client';
import type { TimelineRender, Timeline, File } from '@project/shared';

type RenderRecord = TimelineRender & {
  expand?: { FileRef?: File; TimelineRef?: Timeline };
};

/**
 * Normalize a render's status: PocketBase select fields can arrive as an array,
 * and legacy renders predate the status field entirely — so a present output
 * blob is the source of truth for "done" when status is empty.
 */
function normalizeStatus(render: RenderRecord): string {
  const raw = Array.isArray(render.status) ? render.status[0] : render.status;
  if (raw) return raw;
  return render.expand?.FileRef?.file ? 'success' : 'queued';
}

function RenderViewerContent() {
  const { currentWorkspace } = useWorkspace();
  const params = useParams();
  const router = useRouter();
  const timelineId = params.id as string;
  const renderId = params.renderId as string;

  const [render, setRender] = useState<RenderRecord | null>(null);
  const [siblings, setSiblings] = useState<RenderRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const rendersHref = `/ws/${currentWorkspace?.id}/timelines/${timelineId}/renders`;

  const load = useCallback(async () => {
    if (!renderId) return;
    setIsLoading(true);
    setError(null);
    try {
      const record = await pb
        .collection('TimelineRenders')
        .getOne<RenderRecord>(renderId, { expand: 'FileRef,TimelineRef' });
      setRender(record);

      // Sibling completed renders power the version switcher, so the viewer can
      // flip between this timeline's outputs without leaving the player.
      const list = await pb
        .collection('TimelineRenders')
        .getList<RenderRecord>(1, 100, {
          filter: `TimelineRef = "${timelineId}"`,
          sort: '-created',
          expand: 'FileRef',
        });
      setSiblings(list.items.filter((r) => !!r.expand?.FileRef?.file));
    } catch (err) {
      console.error('Failed to load render:', err);
      setError(err instanceof Error ? err : new Error('Failed to load render'));
    } finally {
      setIsLoading(false);
    }
  }, [renderId, timelineId]);

  useEffect(() => {
    load();
  }, [load]);

  // Live updates: a render may still be queued/running when opened, so subscribe
  // to this record to swap in the player once the worker fills in the output.
  useEffect(() => {
    if (!renderId) return;
    let unsubscribe: (() => void) | undefined;

    (async () => {
      unsubscribe = await pb
        .collection('TimelineRenders')
        .subscribe<RenderRecord>(
          renderId,
          (e: RecordSubscription<RenderRecord>) => {
            if (e.action === 'delete') {
              setRender(null);
              return;
            }
            setRender(e.record);
          },
          { expand: 'FileRef,TimelineRef' }
        );
    })();

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [renderId]);

  const file = render?.expand?.FileRef;
  const status = render ? normalizeStatus(render) : undefined;
  // A plain <a download> anchor pointing straight at the PocketBase file URL —
  // a fetch+blob handler stalls the tab on large renders while the whole file
  // buffers into memory first.
  const playUrl = file?.file ? pb.files.getURL(file, file.file) : undefined;
  const downloadUrl = file?.file
    ? pb.files.getURL(file, file.file, { download: true })
    : undefined;
  const timelineName = render?.expand?.TimelineRef?.name ?? 'Timeline';
  const showSwitcher = !!playUrl && siblings.length > 1;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      {/* Top bar */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-black/70 px-4 py-3 text-white backdrop-blur">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0 text-white hover:bg-white/10 hover:text-white"
            title="Back to renders"
          >
            <Link href={rendersHref}>
              <ArrowLeft className="h-5 w-5" />
              <span className="sr-only">Back to renders</span>
            </Link>
          </Button>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium leading-tight">
              {timelineName}
            </p>
            {render && (
              <p className="text-xs leading-tight text-white/60">
                Version {render.version}
              </p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {showSwitcher && (
            <select
              value={renderId}
              onChange={(e) => router.push(`${rendersHref}/${e.target.value}`)}
              className="rounded-md border border-white/20 bg-white/10 px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-white/40"
              aria-label="Select render version"
            >
              {siblings.map((r) => (
                <option key={r.id} value={r.id} className="text-black">
                  Version {r.version}
                </option>
              ))}
            </select>
          )}
          {downloadUrl && (
            <Button asChild variant="secondary" size="sm">
              <a
                href={downloadUrl}
                download={file?.name || `render-${render?.id}.mp4`}
              >
                <Download className="mr-1.5 h-4 w-4" />
                Download
              </a>
            </Button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        {isLoading ? (
          <Loader2 className="h-8 w-8 animate-spin text-white/80" />
        ) : error ? (
          <div className="w-full max-w-md px-6">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Failed to load render</AlertTitle>
              <AlertDescription>{error.message}</AlertDescription>
            </Alert>
            <Button asChild variant="secondary" className="mt-4">
              <Link href={rendersHref}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to renders
              </Link>
            </Button>
          </div>
        ) : !render ? (
          <div className="px-6 text-center text-white">
            <FileVideo className="mx-auto mb-3 h-10 w-10 text-white/40" />
            <p className="mb-4">This render is no longer available.</p>
            <Button asChild variant="secondary">
              <Link href={rendersHref}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to renders
              </Link>
            </Button>
          </div>
        ) : playUrl ? (
          <video
            key={playUrl}
            src={playUrl}
            controls
            playsInline
            preload="metadata"
            className="h-full w-full object-contain"
          />
        ) : status === 'failed' ? (
          <div className="w-full max-w-md px-6">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Render failed</AlertTitle>
              <AlertDescription className="font-mono text-xs">
                {render.errorLog || 'Unknown error'}
              </AlertDescription>
            </Alert>
          </div>
        ) : (
          <div className="w-full max-w-md px-6 text-center text-white">
            <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin" />
            <p className="mb-3 text-sm">
              {status === 'running'
                ? 'Rendering in the background…'
                : 'Queued — waiting for a worker…'}
            </p>
            <Progress value={render.progress ?? 0} className="h-2" />
          </div>
        )}
      </div>
    </div>
  );
}

export default function RenderViewerPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentWorkspace, isLoading: workspaceLoading } = useWorkspace();

  if (authLoading || workspaceLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-white"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="container mx-auto max-w-4xl px-4 py-8">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Authentication Required</AlertTitle>
          <AlertDescription>
            Please{' '}
            <Link href="/login" className="underline">
              log in
            </Link>{' '}
            to view this render.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!currentWorkspace) {
    return (
      <div className="container mx-auto max-w-4xl px-4 py-8">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Workspace Required</AlertTitle>
          <AlertDescription>
            Please select a workspace from the navigation bar to view this
            render.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return <RenderViewerContent />;
}
