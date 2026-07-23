'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspace } from '@/hooks/use-workspace';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  AlertCircle,
  ArrowLeft,
  Download,
  FileVideo,
  Clock,
  Loader2,
  CheckCircle2,
  XCircle,
  Trash2,
  Play,
} from 'lucide-react';
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
import Link from 'next/link';
import type { RecordSubscription } from 'pocketbase';
import pb from '@/lib/pocketbase-client';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import type { TimelineRender, Timeline, File } from '@project/shared';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';

type RenderRecord = TimelineRender & {
  expand?: { FileRef?: File; TimelineRef?: Timeline };
};

function TimelineRendersPageContent() {
  const { currentWorkspace } = useWorkspace();
  const params = useParams();
  const router = useRouter();
  const timelineId = params.id as string;
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [renders, setRenders] = useState<RenderRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [renderToDelete, setRenderToDelete] = useState<RenderRecord | null>(
    null
  );
  const [isDeleting, setIsDeleting] = useState(false);

  const loadData = useCallback(async () => {
    if (!timelineId) return;

    setIsLoading(true);
    setError(null);

    try {
      // Load timeline
      const timelineRecord = await pb
        .collection('Timelines')
        .getOne<Timeline>(timelineId);
      setTimeline(timelineRecord);

      // Load renders with expanded file and timeline
      const rendersResult = await pb
        .collection('TimelineRenders')
        .getList<RenderRecord>(1, 100, {
          filter: `TimelineRef = "${timelineId}"`,
          sort: '-created',
          expand: 'FileRef,TimelineRef',
        });

      setRenders(rendersResult.items);
    } catch (err) {
      console.error('Failed to load timeline renders:', err);
      const error =
        err instanceof Error
          ? err
          : new Error('Failed to load timeline renders');
      setError(error);
      toast.error(error.message);
    } finally {
      setIsLoading(false);
    }
  }, [timelineId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Live updates: renders are created up-front and filled in by the worker, so
  // subscribe to see queued -> running -> success/failed transitions in place.
  useEffect(() => {
    if (!timelineId) return;
    let unsubscribe: (() => void) | undefined;

    (async () => {
      unsubscribe = await pb
        .collection('TimelineRenders')
        .subscribe<RenderRecord>(
          '*',
          (e: RecordSubscription<RenderRecord>) => {
            if (e.record.TimelineRef !== timelineId) return;
            setRenders((prev) => {
              if (e.action === 'delete') {
                return prev.filter((r) => r.id !== e.record.id);
              }
              const exists = prev.some((r) => r.id === e.record.id);
              if (exists) {
                return prev.map((r) => (r.id === e.record.id ? e.record : r));
              }
              return [e.record, ...prev];
            });
          },
          { expand: 'FileRef,TimelineRef' }
        );
    })();

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [timelineId]);

  // Delete a render and reclaim its storage. The output File is standalone
  // (one per render), so we remove it too. Deleting the File triggers the
  // Files-delete hook that tombstones any external (S3/local) blob for the
  // cleanup worker; PB-native blobs are removed by PocketBase directly.
  const handleConfirmDelete = useCallback(async () => {
    if (!renderToDelete) return;
    const render = renderToDelete;

    setIsDeleting(true);
    try {
      await pb.collection('TimelineRenders').delete(render.id);

      const fileId = render.expand?.FileRef?.id ?? render.FileRef;
      if (fileId) {
        try {
          await pb.collection('Files').delete(fileId);
        } catch (fileErr) {
          // The render record is already gone; a leaked output blob is
          // recoverable by the weekly storage-cleanup task, so don't fail the
          // whole delete over it.
          console.warn('Failed to delete render output file:', fileErr);
        }
      }

      // The realtime subscription also prunes this, but drop it locally so the
      // card disappears immediately even if the event lags.
      setRenders((prev) => prev.filter((r) => r.id !== render.id));
      setRenderToDelete(null);
      toast.success('Render deleted');
    } catch (err) {
      console.error('Failed to delete render:', err);
      toast.error('Failed to delete render');
    } finally {
      setIsDeleting(false);
    }
  }, [renderToDelete]);

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  const renderStatusBadge = (status?: string) => {
    switch (status) {
      case 'success':
        return (
          <Badge variant="default" className="gap-1">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Ready
          </Badge>
        );
      case 'running':
        return (
          <Badge variant="secondary" className="gap-1">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Rendering
          </Badge>
        );
      case 'failed':
        return (
          <Badge variant="destructive" className="gap-1">
            <XCircle className="h-3.5 w-3.5" />
            Failed
          </Badge>
        );
      case 'canceled':
        return <Badge variant="outline">Canceled</Badge>;
      default:
        return (
          <Badge variant="secondary" className="gap-1">
            <Clock className="h-3.5 w-3.5" />
            Queued
          </Badge>
        );
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
        <Button
          variant="outline"
          onClick={() =>
            router.push(`/ws/${currentWorkspace?.id}/timelines/${timelineId}`)
          }
          className="mt-4"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Timeline
        </Button>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      {/* Header */}
      <div className="mb-6">
        <Button
          variant="ghost"
          onClick={() =>
            router.push(`/ws/${currentWorkspace?.id}/timelines/${timelineId}`)
          }
          className="gap-2 mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Timeline
        </Button>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">
              Timeline Renders
            </h1>
            {timeline && (
              <p className="text-muted-foreground mt-1">
                Renders for &quot;{timeline.name}&quot;
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Renders List */}
      {renders.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileVideo className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No renders yet</h3>
            <p className="text-muted-foreground text-center mb-4">
              This timeline hasn&apos;t been rendered yet. Create a render task
              from the timeline editor.
            </p>
            <Button
              variant="outline"
              onClick={() =>
                router.push(
                  `/ws/${currentWorkspace?.id}/timelines/${timelineId}`
                )
              }
            >
              Go to Timeline Editor
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {renders.map((render) => {
            const file = render.expand?.FileRef;
            const rawStatus = Array.isArray(render.status)
              ? render.status[0]
              : render.status;
            // A populated FileRef blob is the source of truth for "downloadable".
            // Legacy renders (created before the status/progress migration) have
            // empty status fields, so we always offer the download when the output
            // file is present — and treat an empty status as completed.
            const hasFile = !!file?.file;
            const status = rawStatus || (hasFile ? 'success' : rawStatus);
            const isDownloadable = hasFile;
            // Plain <a download> anchor pointing straight at the PocketBase
            // file URL — a fetch+blob handler stalls the tab on large
            // renders while the whole file buffers into memory first.
            const downloadUrl = file?.file
              ? pb.files.getURL(file, file.file, { download: true })
              : undefined;
            const createdDate = new Date(render.created);
            const relativeTime = formatDistanceToNow(createdDate, {
              addSuffix: true,
            });

            return (
              <Card key={render.id}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="flex items-center gap-2">
                        <FileVideo className="h-5 w-5" />
                        Version {render.version}
                        {renderStatusBadge(status)}
                      </CardTitle>
                      <CardDescription className="mt-2 flex items-center gap-4">
                        <span className="flex items-center gap-1.5">
                          <Clock className="h-4 w-4" />
                          {relativeTime}
                        </span>
                        {file && (
                          <>
                            <span>•</span>
                            <span>{formatFileSize(file.size || 0)}</span>
                          </>
                        )}
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      {isDownloadable && (
                        <Button asChild variant="outline" className="gap-2">
                          <Link
                            href={`/ws/${currentWorkspace?.id}/timelines/${timelineId}/renders/${render.id}`}
                          >
                            <Play className="h-4 w-4" />
                            Watch
                          </Link>
                        </Button>
                      )}
                      {isDownloadable && downloadUrl && (
                        <Button asChild className="gap-2">
                          <a
                            href={downloadUrl}
                            download={file?.name || `render-${render.id}.mp4`}
                          >
                            <Download className="h-4 w-4" />
                            Download
                          </a>
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => setRenderToDelete(render)}
                        aria-label={`Delete render version ${render.version ?? ''}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>

                {/* In-progress: show a progress indicator while the worker renders */}
                {(status === 'queued' || status === 'running') && (
                  <CardContent>
                    <Progress value={render.progress ?? 0} className="h-2" />
                    <p className="text-sm text-muted-foreground mt-2">
                      {status === 'running'
                        ? 'Rendering in the background…'
                        : 'Queued — waiting for a worker…'}
                    </p>
                  </CardContent>
                )}

                {/* Failed: surface the error */}
                {status === 'failed' && (
                  <CardContent>
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertTitle>Render failed</AlertTitle>
                      <AlertDescription className="font-mono text-xs">
                        {render.errorLog || 'Unknown error'}
                      </AlertDescription>
                    </Alert>
                  </CardContent>
                )}

                {isDownloadable && (
                  <CardContent>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">
                          File Name:
                        </span>
                        <span className="font-mono">{file.name}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">
                          File Status:
                        </span>
                        <span className="capitalize">{file.fileStatus}</span>
                      </div>
                      {file.meta?.renderSettings && (
                        <div className="pt-2 border-t">
                          <p className="text-muted-foreground mb-2">
                            Render Settings:
                          </p>
                          <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                            <div>
                              <span className="text-muted-foreground">
                                Resolution:
                              </span>{' '}
                              {(
                                file.meta.renderSettings as {
                                  resolution?: string;
                                }
                              )?.resolution || 'N/A'}
                            </div>
                            <div>
                              <span className="text-muted-foreground">
                                Codec:
                              </span>{' '}
                              {(file.meta.renderSettings as { codec?: string })
                                ?.codec || 'N/A'}
                            </div>
                            <div>
                              <span className="text-muted-foreground">
                                Frame Rate:
                              </span>{' '}
                              {(file.meta.renderSettings as { fps?: number })
                                ?.fps ?? 30}{' '}
                              fps
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={!!renderToDelete}
        onOpenChange={(open) => {
          if (!open && !isDeleting) setRenderToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Render</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete version{' '}
              {renderToDelete?.version ?? ''}? This permanently removes the
              rendered video file and frees its storage. This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleConfirmDelete();
              }}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function TimelineRendersPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentWorkspace, isLoading: workspaceLoading } = useWorkspace();

  // Show loading state
  if (authLoading || workspaceLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  // Redirect to login if not authenticated
  if (!isAuthenticated) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Authentication Required</AlertTitle>
          <AlertDescription>
            Please{' '}
            <Link href="/login" className="underline">
              log in
            </Link>{' '}
            to access timeline renders.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // Show workspace selection prompt if no workspace selected
  if (!currentWorkspace) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Workspace Required</AlertTitle>
          <AlertDescription>
            Please select a workspace from the navigation bar to view timeline
            renders.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return <TimelineRendersPageContent />;
}
