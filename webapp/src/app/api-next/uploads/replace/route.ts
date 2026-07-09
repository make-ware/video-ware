import 'server-only';

import PocketBase from 'pocketbase';
import { NextResponse } from 'next/server';

import {
  createServerPocketBaseClient,
  authenticateAsUser,
} from '@/lib/pocketbase-server';
import { createStorageBackend } from '@project/shared/storage';
import { loadStorageConfig } from '@project/shared/config';
import { UploadMutator } from '@project/shared/mutator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Media file REPLACE handler (chunked).
 *
 * Overwrites the stored ORIGINAL blob of an existing upload with a new file,
 * keeping everything else about the Media untouched. Unlike the normal upload
 * finalize (`/api-next/uploads/upload`), this route:
 *
 *  - writes to the upload's EXISTING `externalPath` (the deterministic
 *    `uploads/{ws}/{uploadId}/original.{ext}` key), so proxy/thumbnail/label
 *    references keep resolving to the same media, and
 *  - does NOT modify the Upload record. The ingest hook only fires on the
 *    transition INTO `uploaded`; since the record already sits at `uploaded`
 *    and we never touch it, no re-transcode / re-label pipeline is triggered.
 *    Previews and labels intentionally keep reflecting the old file until the
 *    user regenerates them manually.
 *
 * To avoid corrupting a good original if a replace fails midway, chunks are
 * assembled at a temporary key and atomically promoted onto `externalPath`
 * (filesystem rename locally, server-side copy on S3) only on the last chunk.
 *
 * Required headers:
 * - x-upload-id: The upload record whose original is being replaced
 * - x-workspace-id: The workspace ID (must match the upload)
 * - x-user-id: The requesting user ID
 * - x-file-name: The original file name (used only for logging/context)
 * - x-chunk-index: Current chunk number (0-based)
 * - x-total-chunks: Total number of chunks
 */
export async function PUT(req: Request) {
  let pb: PocketBase | null = null;

  try {
    const uploadId = String(req.headers.get('x-upload-id') || '').trim();
    const workspaceId = String(req.headers.get('x-workspace-id') || '').trim();
    const userId = String(req.headers.get('x-user-id') || '').trim();
    const fileName = String(req.headers.get('x-file-name') || '').trim();
    const chunkIndexHeader = req.headers.get('x-chunk-index');
    const totalChunksHeader = req.headers.get('x-total-chunks');
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

    const uploadMutator = new UploadMutator(pb);
    const upload = await uploadMutator.getById(uploadId);
    if (!upload) {
      return NextResponse.json(
        { error: `Upload not found: ${uploadId}` },
        { status: 404 }
      );
    }

    if (upload.WorkspaceRef !== workspaceId) {
      return NextResponse.json(
        { error: 'Workspace mismatch' },
        { status: 403 }
      );
    }

    // We overwrite the existing stored original in place; without one there is
    // nothing to replace (the media was never ingested).
    const targetPath = upload.externalPath;
    if (!targetPath) {
      return NextResponse.json(
        {
          error:
            'This media has no stored original file to replace. Re-upload it instead.',
        },
        { status: 400 }
      );
    }

    // Stage chunks next to the original so the promote is a same-directory
    // rename on the local backend. Deterministic per-upload key so every chunk
    // request (each a separate call) targets the same staging object.
    const stagingPath = `${targetPath}.replacing`;

    const storage = await createStorageBackend(loadStorageConfig());

    const isFirstChunk = chunkIndex === 0;
    const isLastChunk = chunkIndex === totalChunks - 1;

    try {
      await storage.uploadChunk(
        req.body,
        stagingPath,
        chunkIndex,
        totalChunks,
        isFirstChunk,
        isLastChunk
      );
    } catch (storageError) {
      console.error(
        `Failed to write replacement chunk ${chunkIndex}:`,
        storageError
      );
      throw new Error(
        `Storage upload failed: ${storageError instanceof Error ? storageError.message : 'Unknown error'}`
      );
    }

    // On the final chunk, atomically promote the staged file onto the original
    // key. The Upload record is intentionally left untouched.
    if (isLastChunk) {
      await storage.move(stagingPath, targetPath);

      return NextResponse.json({
        success: true,
        complete: true,
        uploadId,
        externalPath: targetPath,
        chunkIndex,
        totalChunks,
      });
    }

    return NextResponse.json({
      success: true,
      complete: false,
      uploadId,
      chunkIndex,
      totalChunks,
    });
  } catch (error) {
    console.error('Replace route error:', error);
    const message =
      error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
