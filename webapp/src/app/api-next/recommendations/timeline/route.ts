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
 * GET /api-next/recommendations/timeline
 *
 * Query parameters:
 * - workspaceId: Workspace ID (required)
 * - timelineId: Timeline ID (required)
 * - seedClipId: Optional MediaClip ID to use as seed for recommendations
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const workspaceId = searchParams.get('workspaceId');
    const timelineId = searchParams.get('timelineId');
    const seedClipId = searchParams.get('seedClipId') || undefined;

    if (!workspaceId || !timelineId) {
      return NextResponse.json(
        { error: 'Missing required query parameters: workspaceId, timelineId' },
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

    const maxResults = parseInt(searchParams.get('maxResults') || '10');

    const recommendationService = createRecommendationService(pb);
    const recommendations =
      await recommendationService.getTimelineRecommendations(
        workspaceId,
        timelineId,
        seedClipId,
        {},
        maxResults
      );

    return NextResponse.json({ items: recommendations });
  } catch (error) {
    console.error('Timeline recommendations error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}
