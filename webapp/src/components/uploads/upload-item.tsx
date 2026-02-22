'use client';

/**
 * UploadItem Component
 *
 * Displays an individual upload item with:
 * - File name, size, and type
 * - Chunked progress bar showing individual chunk uploads
 * - Cancel/retry buttons
 * - Error messages
 * - Thumbnail preview for images/videos
 */

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  FileVideo,
  FileImage,
  File as FileIcon,
  X,
  RefreshCw,
  AlertCircle,
  Loader2,
  CheckCircle2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { UploadItem as UploadItemType } from '@/types/upload-manager';
import { UploadItemStatus } from '@/types/upload-manager';
import { formatBytes } from '@/utils/upload-progress';
import { ChunkedProgressBar, SimpleProgressBar } from './upload-progress';

interface UploadItemProps {
  item: UploadItemType;
  onCancel?: (id: string) => void;
  onRetry?: (id: string) => void;
  onRemove?: (id: string) => void;
  className?: string;
  // Chunk progress (optional, for chunked uploads)
  chunkProgress?: {
    currentChunk: number;
    totalChunks: number;
    chunkProgress: number;
  };
}

export function UploadItem({
  item,
  onCancel,
  onRetry,
  onRemove,
  className,
  chunkProgress,
}: UploadItemProps) {
  // Get appropriate icon based on file type
  const getFileIcon = () => {
    if (item.fileType.startsWith('video/')) {
      return <FileVideo className="h-5 w-5" />;
    }
    if (item.fileType.startsWith('image/')) {
      return <FileImage className="h-5 w-5" />;
    }
    return <FileIcon className="h-5 w-5" />;
  };

  // Get status badge variant
  const getStatusVariant = () => {
    switch (item.status) {
      case UploadItemStatus.COMPLETED:
        return 'default';
      case UploadItemStatus.FAILED:
        return 'destructive';
      case UploadItemStatus.UPLOADING:
        return 'secondary';
      default:
        return 'secondary';
    }
  };

  // Get status icon
  const getStatusIcon = () => {
    switch (item.status) {
      case UploadItemStatus.UPLOADING:
        return <Loader2 className="h-3 w-3 animate-spin" />;
      case UploadItemStatus.COMPLETED:
        return <CheckCircle2 className="h-3 w-3" />;
      case UploadItemStatus.FAILED:
        return <AlertCircle className="h-3 w-3" />;

      default:
        return null;
    }
  };

  const isUploading = item.status === UploadItemStatus.UPLOADING;
  const isFailed = item.status === UploadItemStatus.FAILED;
  const isCompleted = item.status === UploadItemStatus.COMPLETED;
  const isQueued = item.status === UploadItemStatus.QUEUED;
  const isCancelled = item.status === UploadItemStatus.CANCELLED;

  const showProgress = isUploading;
  const showActions = !isCompleted && !isCancelled;

  return (
    <div
      className={cn(
        'flex items-start gap-3 p-3 border rounded-lg transition-colors',
        isFailed && 'border-red-200 bg-red-50/50',
        isUploading && 'border-blue-200 bg-blue-50/50',
        isCompleted && 'border-green-200 bg-green-50/50',
        className
      )}
    >
      {/* File icon (Thumbnails removed for memory efficiency) */}
      <div className="flex-shrink-0">
        <div className="w-10 h-10 rounded bg-gray-100 flex items-center justify-center text-gray-400">
          {getFileIcon()}
        </div>
      </div>

      {/* Upload info */}
      <div className="flex-1 min-w-0 space-y-1.5">
        {/* File name and status */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate text-sm">{item.fileName}</p>
            <p className="text-xs text-gray-500">
              {formatBytes(item.fileSize)}
            </p>
          </div>
          <Badge variant={getStatusVariant()} className="flex-shrink-0 gap-1">
            {getStatusIcon()}
            <span className="capitalize">{item.status}</span>
          </Badge>
        </div>

        {/* Progress bar */}
        {showProgress && (
          <div className="space-y-1">
            {chunkProgress && chunkProgress.totalChunks > 1 ? (
              <ChunkedProgressBar
                currentChunk={chunkProgress.currentChunk}
                totalChunks={chunkProgress.totalChunks}
                chunkProgress={chunkProgress.chunkProgress}
                overallProgress={item.progress.percentage}
              />
            ) : (
              <SimpleProgressBar progress={item.progress.percentage} />
            )}
            <div className="flex items-center justify-between text-xs text-gray-500">
              <span>
                {formatBytes(item.progress.loaded)} of{' '}
                {formatBytes(item.progress.total)}
              </span>
            </div>
          </div>
        )}

        {/* Queued status */}
        {isQueued && (
          <p className="text-xs text-gray-500">Waiting to start...</p>
        )}

        {/* Error message */}
        {isFailed && item.error && (
          <div className="flex items-start gap-2 p-2 bg-red-100 border border-red-200 rounded text-xs">
            <AlertCircle className="h-3.5 w-3.5 text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-red-700 flex-1">{item.error}</p>
          </div>
        )}
      </div>

      {/* Action buttons */}
      {showActions && (
        <div className="flex-shrink-0 flex items-center gap-1">
          {/* Retry button */}
          {isFailed && onRetry && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onRetry(item.id)}
              className="h-8 w-8 p-0"
              title="Retry upload"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          )}

          {/* Remove button (for failed items) */}
          {isFailed && onRemove && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onRemove(item.id)}
              className="h-8 w-8 p-0 text-gray-500 hover:text-red-600 hover:bg-red-50"
              title="Remove from queue"
            >
              <X className="h-4 w-4" />
            </Button>
          )}

          {/* Cancel button */}
          {(isUploading || isQueued) && onCancel && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onCancel(item.id)}
              className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
              title="Cancel upload"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
