'use client';

import React, { useCallback } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspace } from '@/hooks/use-workspace';
import { useUpload } from '@/hooks/use-upload';
import { useUploadQueue } from '@/hooks/use-upload-queue';
import { UploadProvider } from '@/contexts/upload-context';
import { UploadList } from '@/components/upload';
import { UploadDropzone } from '@/components/uploads/upload-dropzone';
import { UploadPanel } from '@/components/uploads/upload-panel';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, Upload as UploadIcon } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

function UploadsPageContent() {
  const { uploads, uploadProgress, isLoading, retryUpload, cancelUpload } =
    useUpload();
  const { currentWorkspace } = useWorkspace();
  const { actions } = useUploadQueue();

  // Handle files selected from dropzone
  const handleFilesSelected = useCallback(
    (files: File[]) => {
      if (currentWorkspace) {
        actions.addFiles(files, currentWorkspace.id);
      }
    },
    [currentWorkspace, actions]
  );

  if (!currentWorkspace) {
    return null;
  }

  return (
    <div className="container mx-auto px-4 py-4 sm:py-6 max-w-4xl">
      {/* Page Header */}
      <div className="mb-4">
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-1">
          Uploads
        </h1>
        <p className="text-sm text-muted-foreground">
          Upload and manage your media files
        </p>
      </div>

      {/* Combined Upload Card */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <UploadIcon className="h-4 w-4" />
            Upload Files
          </CardTitle>
          <CardDescription className="text-xs">
            Video & Audio (MP4, WebM, MP3, WAV, etc.) • Max 24GB
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Dropzone */}
          <UploadDropzone
            onFilesSelected={handleFilesSelected}
            accept={[
              'video/mp4',
              'video/webm',
              'video/quicktime',
              'video/x-msvideo',
              'video/x-matroska',
              'audio/mpeg',
              'audio/wav',
              'audio/x-m4a',
              'audio/aac',
              'audio/ogg',
              'audio/flac',
            ]}
            maxSize={24 * 1024 * 1024 * 1024} // 24GB (chunked upload)
          />

          {/* Upload Queue */}
          <UploadPanel />
        </CardContent>
      </Card>

      {/* Completed Uploads */}
      <div className="mt-4">
        <UploadList
          uploads={uploads}
          uploadProgress={uploadProgress}
          isLoading={isLoading}
          onRetry={retryUpload}
          onCancel={cancelUpload}
          title="Recent Uploads"
          description="View your uploaded files"
        />
      </div>

      {/* Quick Action */}
      <div className="mt-4">
        <Link href={`/ws/${currentWorkspace.id}/media`}>
          <Button className="w-full sm:w-auto">View Media Gallery</Button>
        </Link>
      </div>
    </div>
  );
}

export default function UploadsPage() {
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
            to access uploads.
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
            Please select a workspace from the navigation bar to upload files.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <UploadProvider workspaceId={currentWorkspace.id}>
      <UploadsPageContent />
    </UploadProvider>
  );
}
