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
 * GET /api-next/recommendations/timeline-clips-replace
 *
 * Query parameters:
 * - workspaceId: Workspace ID (required)
 * - timelineId: Timeline ID (required)
 * - timelineClipId: The ID of the timeline clip to find replacements for (required)
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const workspaceId = searchParams.get('workspaceId');
    const timelineId = searchParams.get('timelineId');
    const timelineClipId = searchParams.get('timelineClipId');

    if (!workspaceId || !timelineId || !timelineClipId) {
      return NextResponse.json(
        {
          error:
            'Missing required query parameters: workspaceId, timelineId, timelineClipId',
        },
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

    const recommendationService = createRecommendationService(pb);
    const recommendations =
      await recommendationService.getTimelineClipReplacementRecommendations(
        workspaceId,
        timelineId,
        timelineClipId
      );

    return NextResponse.json({ items: recommendations });
  } catch (error) {
    console.error('Timeline clip replacement recommendations error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}
