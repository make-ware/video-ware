import 'server-only';

import { NextResponse } from 'next/server';

import {
  createServerPocketBaseClient,
  authenticateAsUser,
} from '@/lib/pocketbase-server';
import { createStorageBackend } from '@project/shared/storage';
import { loadStorageConfig } from '@project/shared/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Delete all storage files for a media's upload directory.
 *
 * POST /api-next/media/delete-storage
 * Body: { workspaceId: string, uploadId: string }
 */
export async function POST(req: Request) {
  try {
    // Authenticate
    const pb = createServerPocketBaseClient();
    try {
      await authenticateAsUser(pb, req);
    } catch (authError) {
      const message =
        authError instanceof Error
          ? authError.message
          : 'Authentication failed';
      return NextResponse.json({ error: message }, { status: 401 });
    }

    const body = await req.json();
    const { workspaceId, uploadId } = body;

    if (!workspaceId || !uploadId) {
      return NextResponse.json(
        { error: 'Missing required fields: workspaceId, uploadId' },
        { status: 400 }
      );
    }

    // Initialize storage backend
    const storageConfig = loadStorageConfig();
    const storage = await createStorageBackend(storageConfig);

    // List and delete all files under the upload prefix
    const prefix = `uploads/${workspaceId}/${uploadId}/`;
    const files = await storage.listFiles(prefix);

    let deleted = 0;
    let failed = 0;

    const results = await Promise.allSettled(
      files.map((file) => storage.delete(file.key))
    );

    results.forEach((result) => {
      if (result.status === 'fulfilled') {
        deleted++;
      } else {
        failed++;
        console.error('Failed to delete storage file:', result.reason);
      }
    });

    return NextResponse.json({ deleted, failed, total: files.length });
  } catch (error) {
    console.error('Storage cleanup error:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Storage cleanup failed',
      },
      { status: 500 }
    );
  }
}
