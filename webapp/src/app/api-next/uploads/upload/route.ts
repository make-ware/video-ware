import 'server-only';

import PocketBase from 'pocketbase';
import { NextResponse } from 'next/server';

import {
  createServerPocketBaseClient,
  authenticateAsUser,
} from '@/lib/pocketbase-server';
import {
  createStorageBackend,
  generateStoragePath,
} from '@project/shared/storage';
import { loadStorageConfig } from '@project/shared/config';
import { UploadStatus, StorageBackendType } from '@project/shared';
import { UploadMutator } from '@project/shared/mutator';
import { UploadService } from '@/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Chunked upload handler for large files behind proxies with size limits.
 *
 * Handles individual chunks of a larger file upload. Each chunk is uploaded
 * separately to bypass proxy limits (e.g., Cloudflare Tunnel's 100MB limit).
 *
 * Required headers:
 * - x-upload-id: The upload record ID
 * - x-workspace-id: The workspace ID
 * - x-user-id: The user ID
 * - x-file-name: The original file name
 * - x-chunk-index: Current chunk number (0-based)
 * - x-total-chunks: Total number of chunks
 * - x-chunk-size: Size of this chunk in bytes
 *
 * Optional:
 * - content-length: Size of the chunk
 * - content-type: MIME type
 */
export async function PUT(req: Request) {
  let pb: PocketBase | null = null;
  let uploadMutator: UploadMutator | null = null;
  let uploadId: string | null = null;

  try {
    const uploadIdHeader = req.headers.get('x-upload-id');
    const workspaceIdHeader = req.headers.get('x-workspace-id');
    const userIdHeader = req.headers.get('x-user-id');
    const fileNameHeader = req.headers.get('x-file-name');
    const chunkIndexHeader = req.headers.get('x-chunk-index');
    const totalChunksHeader = req.headers.get('x-total-chunks');

    uploadId = String(uploadIdHeader || '').trim();
    const workspaceId = String(workspaceIdHeader || '').trim();
    const userId = String(userIdHeader || '').trim();
    const fileName = String(fileNameHeader || '').trim();
    const chunkIndex = chunkIndexHeader ? parseInt(chunkIndexHeader, 10) : 0;
    const totalChunks = totalChunksHeader ? parseInt(totalChunksHeader, 10) : 1;

    if (!uploadId || !workspaceId || !userId || !fileName) {
      return NextResponse.json(
        {
          error:
            'Missing required headers: x-upload-id, x-workspace-id, x-user-id, x-file-name',
        },
        { status: 400 }
      );
    }

    if (isNaN(chunkIndex) || isNaN(totalChunks) || chunkIndex >= totalChunks) {
      return NextResponse.json(
        { error: 'Invalid chunk index or total chunks' },
        { status: 400 }
      );
    }

    if (!req.body) {
      return NextResponse.json(
        { error: 'Missing request body' },
        { status: 400 }
      );
    }

    // Server-side PocketBase client (authenticate as the requesting user)
    pb = createServerPocketBaseClient();
    try {
      await authenticateAsUser(pb, req);
    } catch (authError) {
      const message =
        authError instanceof Error
          ? authError.message
          : 'Authentication failed';
      return NextResponse.json({ error: message }, { status: 401 });
    }

    uploadMutator = new UploadMutator(pb);

    const upload = await uploadMutator.getById(uploadId);
    if (!upload) {
      return NextResponse.json(
        { error: `Upload not found: ${uploadId}` },
        { status: 404 }
      );
    }

    if (
      upload.status !== UploadStatus.QUEUED &&
      upload.status !== UploadStatus.UPLOADING
    ) {
      return NextResponse.json(
        {
          error: `Upload is not in a valid state for upload. Current status: ${upload.status}`,
        },
        { status: 400 }
      );
    }

    if (upload.WorkspaceRef !== workspaceId) {
      return NextResponse.json(
        { error: 'Workspace mismatch' },
        { status: 403 }
      );
    }

    // Initialize storage backend from env (local or s3)
    const storageConfig = loadStorageConfig();
    const storage = await createStorageBackend(storageConfig);

    const extension = fileName.split('.').pop() || 'bin';
    const storagePath = generateStoragePath(workspaceId, uploadId, extension);

    // For chunked uploads, append chunk to the file
    // The storage backend handles multipart uploads for S3 or file appending for local
    const isFirstChunk = chunkIndex === 0;
    const isLastChunk = chunkIndex === totalChunks - 1;

    // Update status to UPLOADING on first chunk only
    if (isFirstChunk && upload.status === UploadStatus.QUEUED) {
      try {
        await uploadMutator.updateStatus(uploadId, UploadStatus.UPLOADING);
      } catch (statusError) {
        console.error(
          'Failed to update upload status to UPLOADING:',
          statusError
        );
      }
    }

    // Upload chunk to storage
    try {
      await storage.uploadChunk(
        req.body,
        storagePath,
        chunkIndex,
        totalChunks,
        isFirstChunk,
        isLastChunk
      );
    } catch (storageError) {
      console.error(`Failed to upload chunk ${chunkIndex}:`, storageError);
      throw new Error(
        `Storage upload failed: ${storageError instanceof Error ? storageError.message : 'Unknown error'}`
      );
    }

    // If this is the last chunk, finalize the upload
    if (isLastChunk) {
      const storageMetadata: Record<string, unknown> = {
        type: storageConfig.type,
      };
      if (storageConfig.type === StorageBackendType.S3 && storageConfig.s3) {
        storageMetadata.bucket = storageConfig.s3.bucket;
        storageMetadata.region = storageConfig.s3.region;
        storageMetadata.endpoint = storageConfig.s3.endpoint;
      }

      // Update upload record with final status and metadata
      const updatedUpload = await uploadMutator.update(uploadId, {
        status: UploadStatus.UPLOADED,
        storageBackend: storageConfig.type,
        externalPath: storagePath,
        storageConfig: storageMetadata,
        bytesUploaded: upload.size || 0,
        name: fileName,
      });

      try {
        const uploadService = new UploadService(pb);
        await uploadService.processUploadAndDetectLabels(
          workspaceId,
          uploadId,
          userId
        );

        console.log(`Processing task created for upload ${uploadId}`);
      } catch (taskError) {
        console.error('Failed to enqueue processing task:', taskError);
        // Don't fail the upload if task creation fails
      }

      return NextResponse.json({
        success: true,
        complete: true,
        upload: updatedUpload,
        chunkIndex,
        totalChunks,
      });
    }

    // Return progress for intermediate chunks
    return NextResponse.json({
      success: true,
      complete: false,
      chunkIndex,
      totalChunks,
      uploadId,
    });
  } catch (error) {
    if (uploadMutator && uploadId) {
      try {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error occurred';
        await uploadMutator.updateStatus(
          uploadId,
          UploadStatus.FAILED,
          `Upload failed: ${errorMessage}`
        );
      } catch {
        // ignore
      }
    }

    console.error('Upload route error:', error);
    const message =
      error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
