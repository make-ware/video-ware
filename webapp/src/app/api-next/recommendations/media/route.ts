import 'server-only';
import { NextResponse } from 'next/server';
import {
  createServerPocketBaseClient,
  authenticateAsUser,
} from '@/lib/pocketbase-server';
import { createRecommendationService } from '@/services/recommendation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api-next/recommendations/media
 *
 * Query parameters:
 * - workspaceId: Workspace ID (required)
 * - mediaId: Media ID (required)
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const workspaceId = searchParams.get('workspaceId');
    const mediaId = searchParams.get('mediaId');

    if (!workspaceId || !mediaId) {
      return NextResponse.json(
        { error: 'Missing required query parameters: workspaceId, mediaId' },
        { status: 400 }
      );
    }

    const pb = createServerPocketBaseClient();
    try {
      await authenticateAsUser(pb, req);
    } catch (authError) {
      return NextResponse.json(
        {
          error:
            authError instanceof Error
              ? authError.message
              : 'Authentication failed',
        },
        { status: 401 }
      );
    }

    const maxResults = parseInt(searchParams.get('maxResults') || '20');
    const maxDuration = parseInt(searchParams.get('maxDuration') || '3600');

    const recommendationService = createRecommendationService(pb);
    const recommendations = await recommendationService.getMediaRecommendations(
      workspaceId,
      mediaId,
      {
        durationRange: { min: 0, max: maxDuration },
      },
      maxResults
    );

    return NextResponse.json({ items: recommendations });
  } catch (error) {
    console.error('Media recommendations error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}
