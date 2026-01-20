'use client';

import type { Upload } from '@project/shared';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FileVideo, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface UploadProgressProps {
  upload: Upload;
  bytesUploaded?: number;
  onCancel?: (uploadId: string) => Promise<void>;
  className?: string;
}

export function UploadProgress({
  upload,
  bytesUploaded = 0,
  onCancel,
  className,
}: UploadProgressProps) {
  const totalBytes = upload.size;
  const progressPercentage =
    totalBytes > 0 ? Math.round((bytesUploaded / totalBytes) * 100) : 0;

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    if (bytes < 1024 * 1024 * 1024)
      return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const handleCancel = async () => {
    if (onCancel) {
      try {
        await onCancel(upload.id);
      } catch (error) {
        console.error('Failed to cancel upload:', error);
      }
    }
  };

  const isUploading = upload.status === 'uploading';
  const isProcessing = upload.status === 'processing';
  const isActive = isUploading || isProcessing;

  return (
    <Card className={cn('', className)}>
      <CardContent className="pt-6">
        <div className="flex items-start gap-4">
          {/* File icon */}
          <div className="flex-shrink-0">
            <FileVideo className="h-8 w-8 text-blue-500" />
          </div>

          {/* Upload info */}
          <div className="flex-1 min-w-0 space-y-2">
            {/* File name and status */}
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium truncate">{upload.name}</p>
              <Badge
                variant={
                  upload.status === 'ready'
                    ? 'default'
                    : upload.status === 'failed'
                      ? 'destructive'
                      : 'secondary'
                }
              >
                {upload.status}
              </Badge>
            </div>

            {/* Progress bar */}
            {isActive && (
              <div className="space-y-1">
                <Progress value={progressPercentage} className="h-2" />
                <div className="flex items-center justify-between text-sm text-gray-500">
                  <span>
                    {formatBytes(bytesUploaded)} / {formatBytes(totalBytes)}
                  </span>
                  <span>{progressPercentage}%</span>
                </div>
              </div>
            )}

            {/* Status message */}
            {isProcessing && (
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Processing video...</span>
              </div>
            )}

            {upload.status === 'ready' && (
              <p className="text-sm text-green-600">Upload complete</p>
            )}

            {upload.status === 'failed' && upload.errorMessage && (
              <p className="text-sm text-red-600">{upload.errorMessage}</p>
            )}
          </div>

          {/* Cancel button */}
          {isUploading && onCancel && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCancel}
              className="flex-shrink-0"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
