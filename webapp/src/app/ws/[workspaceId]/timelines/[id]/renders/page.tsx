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
} from 'lucide-react';
import Link from 'next/link';
import pb from '@/lib/pocketbase-client';
import type { TimelineRender, Timeline, File } from '@project/shared';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';

function TimelineRendersPageContent() {
  const { currentWorkspace } = useWorkspace();
  const params = useParams();
  const router = useRouter();
  const timelineId = params.id as string;
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [renders, setRenders] = useState<
    Array<
      TimelineRender & { expand?: { FileRef?: File; TimelineRef?: Timeline } }
    >
  >([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

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
        .getList<TimelineRender>(1, 100, {
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

  const handleDownload = useCallback(
    async (render: TimelineRender & { expand?: { FileRef?: File } }) => {
      const file = render.expand?.FileRef;
      if (!file || !file.file) {
        toast.error('File not available for download');
        return;
      }

      try {
        // Get the file URL from PocketBase
        const fileUrl = pb.files.getURL(file, file.file);

        // Fetch the file as a blob to force download behavior
        const response = await fetch(fileUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch file: ${response.statusText}`);
        }

        const blob = await response.blob();
        const blobUrl = window.URL.createObjectURL(blob);

        // Create a temporary anchor element to trigger download
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = file.name || `render-${render.id}.mp4`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // Clean up the blob URL
        window.URL.revokeObjectURL(blobUrl);

        toast.success('Download started');
      } catch (err) {
        console.error('Failed to download file:', err);
        toast.error('Failed to download file');
      }
    },
    []
  );

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
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
                    {file && (
                      <Button
                        onClick={() => handleDownload(render)}
                        className="gap-2"
                      >
                        <Download className="h-4 w-4" />
                        Download
                      </Button>
                    )}
                  </div>
                </CardHeader>
                {file && (
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
