'use client';

/**
 * UploadPanel Component
 *
 * A simple panel that displays in-flight uploads with:
 * - List of all active and queued uploads
 * - Individual upload controls
 */

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Upload as UploadIcon } from 'lucide-react';
import { useUploadQueue } from '@/hooks/use-upload-queue';
import { UploadItem } from './upload-item';
import { UploadItemStatus } from '@/types/upload-manager';
import { toast } from 'sonner';

interface UploadPanelProps {
  className?: string;
}

export function UploadPanel({ className }: UploadPanelProps) {
  const { state, actions, chunkProgress } = useUploadQueue();
  const [lastCompletedCount, setLastCompletedCount] = useState(0);

  // Show notification when all uploads complete
  useEffect(() => {
    const { items, totalProgress } = state;
    const completedCount = totalProgress.completed;
    const totalCount = totalProgress.total;

    // Check if we just completed all uploads
    if (
      completedCount > lastCompletedCount &&
      completedCount === totalCount &&
      totalCount > 0
    ) {
      const activeItems = items.filter(
        (item) =>
          item.status !== UploadItemStatus.COMPLETED &&
          item.status !== UploadItemStatus.CANCELLED
      );

      if (activeItems.length === 0) {
        toast.success('All uploads completed!', {
          description: `Successfully uploaded ${completedCount} file${completedCount !== 1 ? 's' : ''}`,
          duration: 10000, // Auto-dismiss after 10 seconds
        });
      }
    }

    // Update last completed count asynchronously to avoid cascading renders
    const timeoutId = setTimeout(() => {
      setLastCompletedCount(completedCount);
    }, 0);

    return () => clearTimeout(timeoutId);
  }, [state, lastCompletedCount]);

  const { items } = state;

  // Filter items by status
  const activeItems = items.filter(
    (item) =>
      item.status === UploadItemStatus.UPLOADING ||
      item.status === UploadItemStatus.QUEUED ||
      item.status === UploadItemStatus.PAUSED
  );

  const completedItems = items.filter(
    (item) => item.status === UploadItemStatus.COMPLETED
  );

  const failedItems = items.filter(
    (item) => item.status === UploadItemStatus.FAILED
  );

  // Filter out items that have been entered into the database (have uploadId)
  // These will be shown in the Completed Uploads section instead
  const inFlightItems = items.filter((item) => !item.uploadId);
  const inFlightActiveItems = activeItems.filter((item) => !item.uploadId);
  const inFlightCompletedItems = completedItems.filter(
    (item) => !item.uploadId
  );
  const inFlightFailedItems = failedItems.filter((item) => !item.uploadId);

  const hasAnyUploads = inFlightItems.length > 0;

  return (
    <Card className={className}>
      <CardContent className="pt-0">
        {!hasAnyUploads ? (
          <div className="text-center py-3">
            <UploadIcon className="h-6 w-6 mx-auto mb-1.5 text-muted-foreground/50" />
            <p className="text-xs text-muted-foreground">
              Files will appear here while uploading
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {/* Active uploads */}
            {inFlightActiveItems.length > 0 && (
              <>
                {inFlightActiveItems.map((item) => {
                  const itemChunkProgress = chunkProgress.get(item.id);
                  return (
                    <UploadItem
                      key={item.id}
                      item={item}
                      onCancel={actions.cancelUpload}
                      onRetry={actions.retryUpload}
                      chunkProgress={
                        itemChunkProgress
                          ? {
                              currentChunk: itemChunkProgress.chunkIndex,
                              totalChunks: itemChunkProgress.totalChunks,
                              chunkProgress: itemChunkProgress.chunkProgress,
                            }
                          : undefined
                      }
                    />
                  );
                })}
              </>
            )}

            {/* Separator between active and failed */}
            {inFlightActiveItems.length > 0 &&
              inFlightFailedItems.length > 0 && <Separator className="my-2" />}

            {/* Failed uploads */}
            {inFlightFailedItems.length > 0 && (
              <>
                {inFlightFailedItems.map((item) => (
                  <UploadItem
                    key={item.id}
                    item={item}
                    onRetry={actions.retryUpload}
                    onCancel={actions.cancelUpload}
                    onRemove={actions.removeUpload}
                  />
                ))}
              </>
            )}

            {/* Separator between failed and completed */}
            {(inFlightActiveItems.length > 0 ||
              inFlightFailedItems.length > 0) &&
              inFlightCompletedItems.length > 0 && (
                <Separator className="my-2" />
              )}

            {/* Completed uploads */}
            {inFlightCompletedItems.length > 0 && (
              <>
                {inFlightCompletedItems.map((item) => (
                  <UploadItem key={item.id} item={item} />
                ))}
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
