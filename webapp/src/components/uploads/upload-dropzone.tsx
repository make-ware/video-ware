'use client';

/**
 * UploadDropzone Component
 *
 * A drag-and-drop zone for uploading files with:
 * - Drag-and-drop support for files
 * - File picker button
 * - File type and size validation
 * - Automatic filtering of non-media files
 * - Automatic addition to upload queue
 */

import { useCallback, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Upload, FileVideo, FileImage, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface UploadDropzoneProps {
  onFilesSelected: (files: File[]) => void;
  accept?: string[]; // MIME types to accept
  maxSize?: number; // Maximum file size in bytes
  maxFiles?: number; // Maximum number of files
  disabled?: boolean;
  className?: string;
}

// Default accepted types (video and image files)
const DEFAULT_ACCEPT = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-msvideo',
  'video/x-matroska',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
];

// Default max size: 10GB
const DEFAULT_MAX_SIZE = 10 * 1024 * 1024 * 1024;

export function UploadDropzone({
  onFilesSelected,
  accept = DEFAULT_ACCEPT,
  maxSize = DEFAULT_MAX_SIZE,
  maxFiles,
  disabled = false,
  className,
}: UploadDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

  /**
   * Validate a single file
   */
  const validateFile = useCallback(
    (file: File): string | null => {
      // Check file type
      if (accept.length > 0 && !accept.includes(file.type)) {
        return `Invalid file type: ${file.type}. Allowed types: ${accept.join(', ')}`;
      }

      // Check file size
      if (file.size > maxSize) {
        const maxSizeGB = (maxSize / (1024 * 1024 * 1024)).toFixed(2);
        const fileSizeGB = (file.size / (1024 * 1024 * 1024)).toFixed(2);
        return `File too large: ${fileSizeGB}GB. Maximum size: ${maxSizeGB}GB`;
      }

      return null;
    },
    [accept, maxSize]
  );

  /**
   * Process and validate files
   */
  const processFiles = useCallback(
    (fileList: FileList | File[]): void => {
      setError(null);

      const files = Array.from(fileList);

      if (files.length === 0) {
        return;
      }

      // Filter out non-media files silently
      const mediaFiles = files.filter((file) => {
        return accept.length === 0 || accept.includes(file.type);
      });

      if (mediaFiles.length === 0) {
        setError('No media files found. Please drop video or image files.');
        return;
      }

      // Check max files limit
      if (maxFiles && mediaFiles.length > maxFiles) {
        setError(`Too many files. Maximum: ${maxFiles}`);
        return;
      }

      // Validate all files
      const validFiles: File[] = [];
      const errors: string[] = [];

      for (const file of mediaFiles) {
        const validationError = validateFile(file);
        if (validationError) {
          errors.push(`${file.name}: ${validationError}`);
        } else {
          validFiles.push(file);
        }
      }

      // Show errors if any
      if (errors.length > 0) {
        setError(errors.join('\n'));
      }

      // Add valid files to queue
      if (validFiles.length > 0) {
        try {
          onFilesSelected(validFiles);
        } catch (err) {
          const errorMessage =
            err instanceof Error
              ? err.message
              : 'Failed to add files to upload queue';
          setError(errorMessage);
        }
      }
    },
    [validateFile, maxFiles, onFilesSelected, accept]
  );

  /**
   * Handle drag enter
   */
  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (disabled) return;

      dragCounterRef.current++;
      if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
        setIsDragging(true);
      }
    },
    [disabled]
  );

  /**
   * Handle drag leave
   */
  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (disabled) return;

      dragCounterRef.current--;
      if (dragCounterRef.current === 0) {
        setIsDragging(false);
      }
    },
    [disabled]
  );

  /**
   * Handle drag over
   */
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  /**
   * Handle drop
   */
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (disabled) return;

      setIsDragging(false);
      dragCounterRef.current = 0;

      // Process dropped files directly (no folder traversal)
      const droppedFiles = Array.from(e.dataTransfer.files);

      if (droppedFiles.length > 0) {
        processFiles(droppedFiles);
      } else {
        setError('No files were found. Please try again.');
      }
    },
    [disabled, processFiles]
  );

  /**
   * Handle file input change
   */
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        processFiles(files);
      }

      // Reset input so the same file can be selected again
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [processFiles]
  );

  /**
   * Handle click to open file picker
   */
  const handleClick = useCallback(() => {
    if (!disabled) {
      fileInputRef.current?.click();
    }
  }, [disabled]);

  return (
    <div className={cn('space-y-3', className)}>
      {/* Error display */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="whitespace-pre-line">
            {error}
          </AlertDescription>
        </Alert>
      )}

      {/* Drop zone */}
      <Card
        className={cn(
          'border-2 border-dashed transition-all cursor-pointer',
          isDragging && 'border-blue-500 bg-blue-50 scale-[1.02]',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={handleClick}
      >
        <CardContent className="flex flex-col items-center justify-center py-4 px-4">
          <input
            ref={fileInputRef}
            type="file"
            accept={accept.join(',')}
            onChange={handleInputChange}
            disabled={disabled}
            multiple={!maxFiles || maxFiles > 1}
            className="hidden"
          />

          {/* Icon */}
          <div className="mb-2">
            {isDragging ? (
              <Upload className="h-6 w-6 text-blue-500 animate-bounce" />
            ) : (
              <div className="flex gap-2">
                <FileVideo className="h-5 w-5 text-gray-400" />
                <FileImage className="h-5 w-5 text-gray-400" />
              </div>
            )}
          </div>

          {/* Text */}
          <p className="text-sm font-medium mb-0.5 text-center">
            {isDragging ? 'Drop your files here' : 'Drag and drop files'}
          </p>
          <p className="text-xs text-gray-500 text-center mb-2">
            or click to browse
          </p>

          {/* Browse button */}
          {!isDragging && (
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                handleClick();
              }}
              disabled={disabled}
            >
              Browse Files
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
