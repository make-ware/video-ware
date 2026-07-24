'use client';

/**
 * UploadProgress Component
 *
 * Displays overall upload progress as a simple percentage bar driven by the
 * total bytes transferred (accurate regardless of how many chunks upload in
 * parallel).
 */

import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

interface SimpleProgressProps {
  progress: number; // 0-100
  className?: string;
}

export function SimpleProgressBar({
  progress,
  className,
}: SimpleProgressProps) {
  return (
    <div className={cn('space-y-2', className)}>
      <Progress value={progress} className="h-2" />
      <div className="flex justify-end">
        <span className="text-xs font-medium text-muted-foreground">
          {progress.toFixed(1)}%
        </span>
      </div>
    </div>
  );
}
