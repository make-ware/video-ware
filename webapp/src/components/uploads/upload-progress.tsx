'use client';

/**
 * UploadProgress Component
 *
 * Displays upload progress with a chunked/dashed progress bar that
 * visually represents individual chunk uploads.
 */

import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

interface ChunkProgressProps {
  currentChunk: number; // 0-based index
  totalChunks: number;
  chunkProgress: number; // 0-100 for current chunk
  overallProgress: number; // 0-100 overall
  className?: string;
}

export function ChunkedProgressBar({
  currentChunk,
  totalChunks,
  chunkProgress,
  overallProgress,
  className,
}: ChunkProgressProps) {
  return (
    <div className={cn('space-y-2', className)}>
      {/* Chunked progress bar */}
      <div className="relative h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className="absolute inset-0 flex gap-[1px]">
          {totalChunks <= 50 ? (
            Array.from({ length: totalChunks }).map((_, index) => {
              const isCompleted = index < currentChunk;
              const isCurrent = index === currentChunk;
              const progress = isCurrent
                ? chunkProgress
                : isCompleted
                  ? 100
                  : 0;

              return (
                <div
                  key={index}
                  className="relative flex-1 bg-gray-200 rounded-sm overflow-hidden"
                >
                  <div
                    className={cn(
                      'h-full transition-all duration-300',
                      isCompleted && 'bg-green-500',
                      isCurrent && 'bg-blue-500'
                    )}
                    style={{ width: `${progress}%` }}
                  />
                </div>
              );
            })
          ) : (
            // Simplified view for many chunks to save memory
            <div className="relative flex-1 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all duration-300"
                style={{ width: `${overallProgress}%` }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Progress text */}
      <div className="flex items-center justify-between text-xs text-gray-600">
        <span>
          Chunk {currentChunk + 1} of {totalChunks}
        </span>
        <span className="font-medium">{overallProgress.toFixed(1)}%</span>
      </div>
    </div>
  );
}

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
        <span className="text-xs font-medium text-gray-600">
          {progress.toFixed(1)}%
        </span>
      </div>
    </div>
  );
}
