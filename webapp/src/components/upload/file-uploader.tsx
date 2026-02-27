'use client';

import { useState, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Upload, FileVideo, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FileUploaderProps {
  onFileSelect: (file: File) => Promise<void>;
  isUploading?: boolean;
  className?: string;
}

const ALLOWED_TYPES = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'audio/mpeg',
  'audio/wav',
  'audio/x-m4a',
  'audio/aac',
  'audio/ogg',
  'audio/flac',
];
const MAX_SIZE = 8 * 1024 * 1024 * 1024; // 8GB

export function FileUploader({
  onFileSelect,
  isUploading = false,
  className,
}: FileUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validateFile = useCallback((file: File): string | null => {
    // Check file type
    if (!ALLOWED_TYPES.includes(file.type)) {
      return `Invalid file type: ${file.type}. Allowed types: ${ALLOWED_TYPES.join(', ')}`;
    }

    // Check file size
    if (file.size > MAX_SIZE) {
      const maxSizeGB = MAX_SIZE / (1024 * 1024 * 1024);
      const fileSizeGB = (file.size / (1024 * 1024 * 1024)).toFixed(2);
      return `File too large: ${fileSizeGB}GB. Maximum size: ${maxSizeGB}GB`;
    }

    return null;
  }, []);

  const handleFileChange = useCallback(
    async (file: File | null) => {
      setError(null);

      if (!file) {
        setSelectedFile(null);
        return;
      }

      // Validate file
      const validationError = validateFile(file);
      if (validationError) {
        setError(validationError);
        setSelectedFile(null);
        return;
      }

      setSelectedFile(file);

      // Automatically start upload
      try {
        await onFileSelect(file);
        setSelectedFile(null);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Upload failed';
        setError(message);
      }
    },
    [validateFile, onFileSelect]
  );

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        handleFileChange(files[0]);
      }
    },
    [handleFileChange]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        handleFileChange(files[0]);
      }
    },
    [handleFileChange]
  );

  const handleClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleClearFile = useCallback(() => {
    setSelectedFile(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    if (bytes < 1024 * 1024 * 1024)
      return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  return (
    <div className={cn('space-y-4', className)}>
      {/* Error display */}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Drop zone */}
      <Card
        className={cn(
          'border-2 border-dashed transition-colors cursor-pointer',
          isDragging && 'border-blue-500 bg-blue-50',
          isUploading && 'opacity-50 cursor-not-allowed'
        )}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={!isUploading ? handleClick : undefined}
      >
        <CardContent className="flex flex-col items-center justify-center py-12 px-6">
          <input
            ref={fileInputRef}
            type="file"
            accept={ALLOWED_TYPES.join(',')}
            onChange={handleInputChange}
            disabled={isUploading}
            className="hidden"
          />

          {selectedFile ? (
            <div className="flex items-center gap-4 w-full">
              <FileVideo className="h-8 w-8 text-blue-500 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{selectedFile.name}</p>
                <p className="text-sm text-gray-500">
                  {formatFileSize(selectedFile.size)}
                </p>
              </div>
              {!isUploading && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleClearFile();
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          ) : (
            <>
              <Upload
                className={cn(
                  'h-12 w-12 mb-4',
                  isDragging ? 'text-blue-500' : 'text-gray-400'
                )}
              />
              <p className="text-lg font-medium mb-2">
                {isDragging ? 'Drop your video here' : 'Upload a video'}
              </p>
              <p className="text-sm text-gray-500 text-center mb-4">
                Drag and drop or click to browse
              </p>
              <p className="text-xs text-gray-400 text-center">
                Supported formats: MP4, WebM, QuickTime
                <br />
                Maximum size: 8GB
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* Upload button (optional, since auto-upload is enabled) */}
      {selectedFile && !isUploading && (
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={handleClearFile}>
            Cancel
          </Button>
          <Button onClick={() => handleFileChange(selectedFile)}>Upload</Button>
        </div>
      )}
    </div>
  );
}
