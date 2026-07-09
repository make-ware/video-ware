'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  AlertTriangle,
  FileVideo,
  Loader2,
  Replace,
  Upload,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { useMediaDetails } from '@/hooks/use-media-details';
import { useAuth } from '@/hooks/use-auth';
import pb from '@/lib/pocketbase-client';
import { ChunkedReplaceService } from '@/services/chunked-replace';
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_SIZE } from '@/constants/upload';
import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(k)),
    sizes.length - 1
  );
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export default function ReplaceMediaPage() {
  const params = useParams();
  const router = useRouter();
  const workspaceId = params.workspaceId as string;
  const id = params.id as string;

  const { media, isLoading, error } = useMediaDetails(id);
  const { user } = useAuth();

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isReplacing, setIsReplacing] = useState(false);
  const [progress, setProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const detailsHref = `/ws/${workspaceId}/media/${id}/details`;

  // The replacement must be the same kind of media (video for video, etc.).
  const mediaType = media?.mediaType;
  const acceptedTypes = useMemo(
    () =>
      mediaType
        ? ALLOWED_UPLOAD_TYPES.filter((t) => t.startsWith(`${mediaType}/`))
        : [],
    [mediaType]
  );

  const upload = media?.expand?.UploadRef;
  const uploadId = media?.UploadRef;
  const currentFileName = upload?.name;
  const hasOriginal = !!upload?.externalPath;

  const validateFile = useCallback(
    (file: File): string | null => {
      if (mediaType && !file.type.startsWith(`${mediaType}/`)) {
        return `Replacement must be a ${mediaType} file. Selected file is "${file.type || 'unknown'}".`;
      }
      if (!ALLOWED_UPLOAD_TYPES.includes(file.type)) {
        return `Unsupported file type: ${file.type || 'unknown'}.`;
      }
      if (file.size > MAX_UPLOAD_SIZE) {
        const maxGB = MAX_UPLOAD_SIZE / 1024 ** 3;
        const fileGB = (file.size / 1024 ** 3).toFixed(2);
        return `File too large: ${fileGB}GB. Maximum size: ${maxGB}GB.`;
      }
      return null;
    },
    [mediaType]
  );

  const handleFileSelect = useCallback(
    (file: File | null) => {
      setValidationError(null);
      if (!file) {
        setSelectedFile(null);
        return;
      }
      const err = validateFile(file);
      if (err) {
        setValidationError(err);
        setSelectedFile(null);
        return;
      }
      setSelectedFile(file);
    },
    [validateFile]
  );

  const clearFile = useCallback(() => {
    setSelectedFile(null);
    setValidationError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const handleReplace = useCallback(async () => {
    if (!selectedFile || !uploadId || !user) return;

    setIsReplacing(true);
    setProgress(0);
    try {
      const service = new ChunkedReplaceService(pb);
      await service.replaceFile(
        uploadId,
        workspaceId,
        user.id,
        selectedFile,
        (overall) => setProgress(overall)
      );

      toast.success('Media file replaced', {
        description:
          'The stored file was overwritten. Previews and labels still reflect the previous file — regenerate them from the details page if needed.',
      });
      router.push(detailsHref);
    } catch (err) {
      console.error('Failed to replace media file:', err);
      toast.error('Failed to replace media file', {
        description:
          err instanceof Error ? err.message : 'An unknown error occurred',
      });
      setIsReplacing(false);
    }
  }, [selectedFile, uploadId, user, workspaceId, router, detailsHref]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !media) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-8">
        <Button
          variant="ghost"
          className="mb-4"
          onClick={() => router.push(detailsHref)}
        >
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Details
        </Button>
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>
            {error?.message || 'Media not found'}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-3xl px-4 py-8">
      {/* Header */}
      <div className="mb-6 flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.push(detailsHref)}
          disabled={isReplacing}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Replace Media File</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {currentFileName || media.label || 'Untitled Media'}
          </p>
        </div>
      </div>

      {/* Warning */}
      <Alert className="mb-6 border-amber-500/50 text-amber-900 dark:text-amber-200 [&>svg]:text-amber-600">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>This overwrites the stored video file</AlertTitle>
        <AlertDescription>
          The original file for this media will be replaced and{' '}
          <strong>cannot be recovered</strong>. Existing previews (thumbnail,
          proxy, sprite, audio, filmstrip) and detected labels are{' '}
          <strong>not</strong> regenerated — they will keep reflecting the old
          file until you regenerate them from the details page. Only replace
          with the same media (for example, a re-graded or re-mixed version) so
          the duration and dimensions still match.
        </AlertDescription>
      </Alert>

      {/* Current media info */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Current Media</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">Type</dt>
              <dd className="font-medium capitalize">{media.mediaType}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Dimensions</dt>
              <dd className="font-medium">
                {media.width} × {media.height}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Duration</dt>
              <dd className="font-medium">{media.duration.toFixed(2)}s</dd>
            </div>
            {upload?.size ? (
              <div>
                <dt className="text-muted-foreground">Current file size</dt>
                <dd className="font-medium">{formatBytes(upload.size)}</dd>
              </div>
            ) : null}
          </dl>
        </CardContent>
      </Card>

      {!hasOriginal ? (
        <Alert variant="destructive">
          <AlertTitle>No file to replace</AlertTitle>
          <AlertDescription>
            This media has no stored original file, so there is nothing to
            overwrite. Upload it again from the Uploads page instead.
          </AlertDescription>
        </Alert>
      ) : (
        <>
          {validationError && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{validationError}</AlertDescription>
            </Alert>
          )}

          {/* Dropzone */}
          <Card
            className={cn(
              'cursor-pointer border-2 border-dashed transition-colors',
              isDragging && 'border-primary bg-primary/5',
              isReplacing && 'pointer-events-none opacity-60'
            )}
            onDragEnter={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDragging(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDragging(false);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDragging(false);
              const files = Array.from(e.dataTransfer.files);
              if (files.length > 0) handleFileSelect(files[0]);
            }}
            onClick={() => !isReplacing && fileInputRef.current?.click()}
          >
            <CardContent className="flex flex-col items-center justify-center px-6 py-12">
              <input
                ref={fileInputRef}
                type="file"
                accept={acceptedTypes.join(',')}
                className="hidden"
                disabled={isReplacing}
                onChange={(e) => {
                  const files = e.target.files;
                  if (files && files.length > 0) handleFileSelect(files[0]);
                }}
              />

              {selectedFile ? (
                <div className="flex w-full items-center gap-4">
                  <FileVideo className="h-8 w-8 flex-shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{selectedFile.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {formatBytes(selectedFile.size)}
                    </p>
                  </div>
                  {!isReplacing && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => {
                        e.stopPropagation();
                        clearFile();
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
                      'mb-4 h-12 w-12',
                      isDragging ? 'text-primary' : 'text-muted-foreground'
                    )}
                  />
                  <p className="mb-2 text-lg font-medium">
                    {isDragging
                      ? 'Drop the replacement here'
                      : `Choose a replacement ${mediaType} file`}
                  </p>
                  <p className="text-center text-sm text-muted-foreground">
                    Drag and drop or click to browse
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          {/* Progress */}
          {isReplacing && (
            <div className="mt-6 space-y-2">
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>Uploading replacement…</span>
                <span>{Math.round(progress)}%</span>
              </div>
              <Progress value={progress} />
            </div>
          )}

          {/* Actions */}
          <div className="mt-6 flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => router.push(detailsHref)}
              disabled={isReplacing}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleReplace}
              disabled={!selectedFile || isReplacing}
            >
              {isReplacing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Replace className="mr-2 h-4 w-4" />
              )}
              {isReplacing ? 'Replacing…' : 'Replace File'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
