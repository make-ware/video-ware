'use client';

import type { Upload } from '@project/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty';
import { FileVideo, RefreshCw, AlertCircle, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface UploadProgress {
  uploadId: string;
  bytesUploaded: number;
  totalBytes: number;
  percentage: number;
}

interface UploadListProps {
  uploads: Upload[];
  uploadProgress?: Map<string, UploadProgress>;
  onRetry?: (uploadId: string) => Promise<void>;
  onCancel?: (uploadId: string) => Promise<void>;
  isLoading?: boolean;
  className?: string;
  title?: string;
  description?: string;
}

export function UploadList({
  uploads,
  uploadProgress,
  onRetry,
  onCancel,
  isLoading = false,
  className,
  title = 'Uploads',
  description,
}: UploadListProps) {
  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    if (bytes < 1024 * 1024 * 1024)
      return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const handleRetry = async (uploadId: string) => {
    if (onRetry) {
      try {
        await onRetry(uploadId);
      } catch (error) {
        console.error('Failed to retry upload:', error);
      }
    }
  };

  const handleCancel = async (uploadId: string) => {
    if (onCancel) {
      try {
        await onCancel(uploadId);
      } catch (error) {
        console.error('Failed to cancel upload:', error);
      }
    }
  };

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader>
          <Skeleton className="h-6 w-32" />
        </CardHeader>
        <CardContent className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <CardTitle className="flex items-center gap-2 text-base">
              <span>{title}</span>
              <Badge variant="secondary" className="text-xs">
                {uploads.length}
              </Badge>
            </CardTitle>
            {description && (
              <p className="text-xs text-muted-foreground">{description}</p>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {uploads.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FileVideo className="h-6 w-6" />
              </EmptyMedia>
              <EmptyTitle>No uploads yet</EmptyTitle>
              <EmptyDescription>
                Upload your first video to get started!
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="space-y-2">
            {uploads.map((upload) => {
              const progress = uploadProgress?.get(upload.id);
              const isUploading = upload.status === 'uploading';
              const isProcessing = upload.status === 'processing';
              const isActive = isUploading || isProcessing;
              const showProgress = isUploading && progress;

              return (
                <div
                  key={upload.id}
                  className={cn(
                    'flex items-start gap-3 p-3 border rounded-lg',
                    upload.status === 'failed' && 'border-red-200 bg-red-50',
                    isActive && 'border-blue-200 bg-blue-50'
                  )}
                >
                  {/* File icon */}
                  <div className="flex-shrink-0">
                    {isActive ? (
                      <Loader2 className="h-6 w-6 text-blue-500 animate-spin" />
                    ) : (
                      <FileVideo
                        className={cn(
                          'h-6 w-6',
                          upload.status === 'failed'
                            ? 'text-red-500'
                            : 'text-blue-500'
                        )}
                      />
                    )}
                  </div>

                  {/* Upload info */}
                  <div className="flex-1 min-w-0 space-y-1.5">
                    {/* File name and status */}
                    <div className="flex items-center gap-2">
                      <p className="font-medium truncate">{upload.name}</p>
                      <Badge
                        variant={
                          upload.status === 'ready'
                            ? 'default'
                            : upload.status === 'failed'
                              ? 'destructive'
                              : 'secondary'
                        }
                        className="flex-shrink-0"
                      >
                        {upload.status}
                      </Badge>
                    </div>

                    {/* Progress bar for active uploads */}
                    {showProgress && (
                      <div className="space-y-1">
                        <Progress value={progress.percentage} className="h-2" />
                        <div className="flex items-center justify-between text-sm text-gray-600">
                          <span>
                            {formatBytes(progress.bytesUploaded)} /{' '}
                            {formatBytes(progress.totalBytes)}
                          </span>
                          <span>{progress.percentage}%</span>
                        </div>
                      </div>
                    )}

                    {/* Status message for processing */}
                    {isProcessing && (
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>Processing video...</span>
                      </div>
                    )}

                    {/* File size and date */}
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                      <span>{formatBytes(upload.size)}</span>
                      <span>•</span>
                      <span>{formatDate(upload.created)}</span>
                    </div>

                    {/* Error message */}
                    {upload.status === 'failed' && upload.errorMessage && (
                      <div className="flex items-start gap-2 mt-2 p-2 bg-red-100 border border-red-200 rounded">
                        <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
                        <p className="text-sm text-red-700">
                          {upload.errorMessage}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Action buttons */}
                  <div className="flex-shrink-0 flex items-center gap-2">
                    {/* Cancel button for active uploads */}
                    {isUploading && onCancel && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleCancel(upload.id)}
                        className="flex-shrink-0"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}

                    {/* Retry button for failed uploads */}
                    {upload.status === 'failed' && onRetry && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleRetry(upload.id)}
                        className="flex-shrink-0"
                      >
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Retry
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
