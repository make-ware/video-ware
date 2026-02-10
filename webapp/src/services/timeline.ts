import type { TypedPocketBase } from '@project/shared/types';
import {
  TimelineMutator,
  TimelineClipMutator,
  TimelineTrackMutator,
  MediaClipMutator,
  MediaMutator,
  TaskMutator,
} from '@project/shared/mutator';
import type {
  Timeline,
  TimelineInput,
  TimelineClip,
  TimelineClipInput,
  Task,
  ValidationResult,
  ValidationError,
  TimelineTrack,
  RenderFlowConfig,
  TimelineTrackRecord,
} from '@project/shared';
import { generateTracks, validateTimeRange } from '@project/shared';

/**
 * Extended Timeline type with clips included
 */
export interface TimelineWithClips extends Timeline {
  clips: TimelineClip[];
  tracks: TimelineTrackRecord[];
}

/**
 * Output settings for render tasks
 * @deprecated Use RenderFlowConfig instead
 */
export type OutputSettings = RenderFlowConfig;

/**
 * Timeline service that provides high-level timeline operations
 * Handles timeline CRUD, clip management, validation, and render task creation
 */
export class TimelineService {
  private pb: TypedPocketBase;
  private timelineMutator: TimelineMutator;
  private timelineClipMutator: TimelineClipMutator;
  private timelineTrackMutator: TimelineTrackMutator;
  private mediaClipMutator: MediaClipMutator;
  private mediaMutator: MediaMutator;
  private taskMutator: TaskMutator;

  constructor(pb: TypedPocketBase) {
    this.pb = pb;
    this.timelineMutator = new TimelineMutator(pb);
    this.timelineClipMutator = new TimelineClipMutator(pb);
    this.timelineTrackMutator = new TimelineTrackMutator(pb);
    this.mediaClipMutator = new MediaClipMutator(pb);
    this.mediaMutator = new MediaMutator(pb);
    this.taskMutator = new TaskMutator(pb);
  }

  // ============================================================================
  // Timeline CRUD Operations
  // ============================================================================

  /**
   * Create a new timeline
   * @param workspaceId Workspace ID
   * @param name Timeline name
   * @returns The created timeline
   */
  async createTimeline(workspaceId: string, name: string): Promise<Timeline> {
    const input: TimelineInput = {
      name,
      WorkspaceRef: workspaceId,
      duration: 0,
      version: 1,
    };
    const timeline = await this.timelineMutator.create(input);

    // Create default track
    await this.timelineTrackMutator.create({
      TimelineRef: timeline.id,
      name: 'Main Track',
      layer: 0,
    });

    return timeline;
  }

  /**
   * Get timeline by ID with clips
   * @param id Timeline ID
   * @returns Timeline with clips or null if not found
   */
  async getTimeline(id: string): Promise<TimelineWithClips | null> {
    const timeline = await this.timelineMutator.getById(id);
    if (!timeline) {
      return null;
    }

    const clips = await this.timelineClipMutator.getByTimeline(id);
    const tracks = await this.timelineTrackMutator.getByTimeline(id);

    return {
      ...timeline,
      clips,
      tracks: tracks.items,
    };
  }

  /**
   * Get all timelines in a workspace
   * @param workspaceId Workspace ID
   * @returns List of timelines
   */
  async getTimelinesByWorkspace(workspaceId: string): Promise<Timeline[]> {
    const result = await this.timelineMutator.getByWorkspace(workspaceId);
    return result.items;
  }

  /**
   * Update timeline
   * @param id Timeline ID
   * @param data Partial timeline data to update
   * @returns The updated timeline
   */
  async updateTimeline(
    id: string,
    data: Partial<TimelineInput>
  ): Promise<Timeline> {
    return this.timelineMutator.update(id, data);
  }

  /**
   * Delete timeline and all associated clips
   * @param id Timeline ID
   */
  async deleteTimeline(id: string): Promise<void> {
    // Get all timeline clips
    const clips = await this.timelineClipMutator.getByTimeline(id);

    // Delete all timeline clips
    await Promise.all(
      clips.map((clip) => this.timelineClipMutator.delete(clip.id))
    );

    // Delete the timeline
    await this.timelineMutator.delete(id);
  }

  // ============================================================================
  // Clip Operations
  // ============================================================================

  /**
   * Add a clip to a timeline
   * @param timelineId Timeline ID
   * @param mediaId Media ID
   * @param start Start time in seconds (in source media)
   * @param end End time in seconds (in source media)
   * @param mediaClipId Optional MediaClip ID (if adding from existing clip)
   * @param trackId Optional track ID (defaults to layer 0)
   * @param timelineStart Optional absolute timeline position in seconds (computed by caller for non-overlapping placement)
   * @returns The created timeline clip
   */
  async addClipToTimeline(
    timelineId: string,
    mediaId: string,
    start: number,
    end: number,
    mediaClipId?: string,
    trackId?: string,
    timelineStart?: number
  ): Promise<TimelineClip> {
    // Get the media to validate time range
    const media = await this.mediaMutator.getById(mediaId);
    if (!media) {
      throw new Error(`Media not found: ${mediaId}`);
    }

    // Determine track
    let targetTrackId = trackId;
    if (!targetTrackId) {
      // Find default track (layer 0)
      const tracks = await this.timelineTrackMutator.getByTimeline(timelineId);
      const defaultTrack =
        tracks.items.find((t) => t.layer === 0) || tracks.items[0];

      if (defaultTrack) {
        targetTrackId = defaultTrack.id;
      } else {
        // Create default track if none exists (legacy support)
        const newTrack = await this.timelineTrackMutator.create({
          TimelineRef: timelineId,
          name: 'Main Track',
          layer: 0,
        });
        targetTrackId = newTrack.id;
      }
    }

    // Validate time range
    if (!validateTimeRange(start, end, media.duration)) {
      throw new Error(
        `Invalid time range: start=${start}, end=${end}, duration=${media.duration}`
      );
    }

    // Validate timelineStart if provided
    if (timelineStart !== undefined && timelineStart < 0) {
      throw new Error(`Invalid timelineStart: ${timelineStart}. Must be >= 0.`);
    }

    // Get the next order position
    const maxOrder = await this.timelineClipMutator.getMaxOrder(timelineId);
    const order = maxOrder + 1;

    // Create the timeline clip
    const input: TimelineClipInput = {
      TimelineRef: timelineId,
      TimelineTrackRef: targetTrackId,
      MediaRef: mediaId,
      MediaClipRef: mediaClipId,
      order,
      start,
      end,
      duration: end - start,
    };

    if (timelineStart !== undefined) {
      input.timelineStart = timelineStart;
    }

    return this.timelineClipMutator.create(input);
  }

  /**
   * Remove a clip from a timeline
   * @param timelineClipId Timeline clip ID
   */
  async removeClipFromTimeline(timelineClipId: string): Promise<void> {
    // Get the clip to find its timeline
    const clip = await this.timelineClipMutator.getById(timelineClipId);
    if (!clip) {
      throw new Error(`Timeline clip not found: ${timelineClipId}`);
    }

    const timelineId = clip.TimelineRef;

    // Delete the clip
    await this.timelineClipMutator.delete(timelineClipId);

    // Reorder remaining clips to fill the gap
    const remainingClips =
      await this.timelineClipMutator.getByTimeline(timelineId);
    const reorderedClips = remainingClips.map((c, index) => ({
      id: c.id,
      order: index,
    }));

    if (reorderedClips.length > 0) {
      await this.timelineClipMutator.reorderClips(timelineId, reorderedClips);
    }
  }

  /**
   * Reorder clips in a timeline
   * @param timelineId Timeline ID
   * @param clipOrders Array of clip IDs with their new order positions
   */
  async reorderClips(
    timelineId: string,
    clipOrders: { id: string; order: number }[]
  ): Promise<void> {
    await this.timelineClipMutator.reorderClips(timelineId, clipOrders);
  }

  /**
   * Update clip start/end times
   * @param timelineClipId Timeline clip ID
   * @param start New start time in seconds
   * @param end New end time in seconds
   * @returns The updated timeline clip
   */
  async updateClipTimes(
    timelineClipId: string,
    start: number,
    end: number
  ): Promise<TimelineClip> {
    // Get the clip to find its media
    const clip = await this.timelineClipMutator.getById(timelineClipId);
    if (!clip) {
      throw new Error(`Timeline clip not found: ${timelineClipId}`);
    }

    // Get the media to validate time range
    const media = await this.mediaMutator.getById(clip.MediaRef);
    if (!media) {
      throw new Error(`Media not found: ${clip.MediaRef}`);
    }

    // Validate time range
    if (!validateTimeRange(start, end, media.duration)) {
      throw new Error(
        `Invalid time range: start=${start}, end=${end}, duration=${media.duration}`
      );
    }

    // Update the clip
    return this.timelineClipMutator.update(timelineClipId, { start, end });
  }

  // ============================================================================
  // Timeline Operations
  // ============================================================================

  /**
   * Save timeline (increment version and generate tracks)
   * @param timelineId Timeline ID
   * @returns The updated timeline
   */
  async saveTimeline(timelineId: string): Promise<Timeline> {
    // Get timeline clips
    const clips = await this.timelineClipMutator.getByTimeline(timelineId);
    // Get tracks
    const tracksList =
      await this.timelineTrackMutator.getByTimeline(timelineId);

    // Generate tracks
    const tracks = generateTracks(clips, tracksList.items);

    // Calculate duration
    const duration = clips.reduce((sum, clip) => {
      return sum + clip.duration;
    }, 0);

    // Increment version
    const timeline = await this.timelineMutator.incrementVersion(timelineId);

    // Update with tracks and duration
    return this.timelineMutator.update(timelineId, {
      timelineData: { trackList: tracks },
      duration,
      version: timeline.version,
    });
  }

  /**
   * Calculate total duration of a timeline
   * @param timelineId Timeline ID
   * @returns Total duration in seconds
   */
  async calculateDuration(timelineId: string): Promise<number> {
    const clips = await this.timelineClipMutator.getByTimeline(timelineId);
    return clips.reduce((sum, clip) => {
      return sum + clip.duration;
    }, 0);
  }

  /**
   * Generate tracks for a timeline
   * @param timelineId Timeline ID
   * @returns TimelineTrack array
   */
  async generateTracks(timelineId: string): Promise<TimelineTrack[]> {
    const clips = await this.timelineClipMutator.getByTimeline(timelineId);
    const tracks = await this.timelineTrackMutator.getByTimeline(timelineId);
    return generateTracks(clips, tracks.items);
  }

  // ============================================================================
  // Validation
  // ============================================================================

  /**
   * Validate a timeline for rendering
   * @param timelineId Timeline ID
   * @returns ValidationResult with any errors found
   */
  async validateTimeline(timelineId: string): Promise<ValidationResult> {
    const errors: ValidationError[] = [];

    // Get timeline clips
    const clips = await this.timelineClipMutator.getByTimeline(timelineId);

    // Check if timeline has clips
    if (clips.length === 0) {
      errors.push({
        code: 'EMPTY_TIMELINE',
        message: 'Timeline has no clips',
        itemId: timelineId,
        itemType: 'timeline',
      });
      return { valid: false, errors };
    }

    // Validate each clip
    for (const clip of clips) {
      // Verify MediaClip reference exists (if provided)
      if (clip.MediaClipRef) {
        const mediaClip = await this.mediaClipMutator.getById(
          clip.MediaClipRef
        );
        if (!mediaClip) {
          errors.push({
            code: 'INVALID_CLIP_REF',
            message: `Timeline clip references non-existent media clip: ${clip.MediaClipRef}`,
            itemId: clip.id,
            itemType: 'timelineClip',
            field: 'MediaClipRef',
            actual: clip.MediaClipRef,
          });
        }
      }

      // Verify Media reference exists
      const media = await this.mediaMutator.getById(clip.MediaRef);
      if (!media) {
        errors.push({
          code: 'INVALID_MEDIA_REF',
          message: `Timeline clip references non-existent media: ${clip.MediaRef}`,
          itemId: clip.id,
          itemType: 'timelineClip',
          field: 'MediaRef',
          actual: clip.MediaRef,
        });
        continue; // Skip time validation if media doesn't exist
      }

      // Verify time offsets are within media duration bounds
      if (!validateTimeRange(clip.start, clip.end, media.duration)) {
        errors.push({
          code: 'OFFSET_OUT_OF_BOUNDS',
          message: `Timeline clip time range exceeds media duration`,
          itemId: clip.id,
          itemType: 'timelineClip',
          field: 'timeRange',
          expected: `0 <= start < end <= ${media.duration}`,
          actual: { start: clip.start, end: clip.end },
        });
      }
    }

    // Verify clip order positions form valid sequence
    const orderValues = clips.map((c) => c.order).sort((a, b) => a - b);
    const expectedOrders = Array.from({ length: clips.length }, (_, i) => i);
    const ordersMatch = orderValues.every(
      (val, idx) => val === expectedOrders[idx]
    );

    if (!ordersMatch) {
      errors.push({
        code: 'INVALID_CLIP_ORDER',
        message: 'Clip order positions do not form a valid sequence',
        itemId: timelineId,
        itemType: 'timeline',
        field: 'clipOrders',
        expected: expectedOrders,
        actual: orderValues,
      });
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  // ============================================================================
  // Clip Positioning Operations
  // ============================================================================

  /**
   * Move a clip to a different track
   * @param clipId Timeline clip ID
   * @param targetTrackId Target track ID
   * @param timelineStart Optional absolute timeline position (seconds)
   * @returns The updated timeline clip
   */
  async moveClipToTrack(
    clipId: string,
    targetTrackId: string,
    timelineStart?: number
  ): Promise<TimelineClip> {
    // Get the clip
    const clip = await this.timelineClipMutator.getById(clipId);
    if (!clip) {
      throw new Error(`Timeline clip not found: ${clipId}`);
    }

    // Get the target track to validate it exists
    const targetTrack = await this.timelineTrackMutator.getById(targetTrackId);
    if (!targetTrack) {
      throw new Error(`Target track not found: ${targetTrackId}`);
    }

    // Verify the target track belongs to the same timeline
    if (targetTrack.TimelineRef !== clip.TimelineRef) {
      throw new Error(
        `Target track belongs to a different timeline. Clip timeline: ${clip.TimelineRef}, Track timeline: ${targetTrack.TimelineRef}`
      );
    }

    // Update the clip with new track and optional position
    const updateData: Partial<TimelineClipInput> = {
      TimelineTrackRef: targetTrackId,
    };

    if (timelineStart !== undefined) {
      updateData.timelineStart = timelineStart;
    }

    return this.timelineClipMutator.update(clipId, updateData);
  }

  /**
   * Update a clip's absolute timeline position
   * @param clipId Timeline clip ID
   * @param timelineStart Absolute timeline position (seconds)
   * @returns The updated timeline clip
   */
  async updateClipPosition(
    clipId: string,
    timelineStart: number
  ): Promise<TimelineClip> {
    // Validate timelineStart is non-negative
    if (timelineStart < 0) {
      throw new Error(`Invalid timelineStart: ${timelineStart}. Must be >= 0.`);
    }

    // Update the clip
    return this.timelineClipMutator.update(clipId, { timelineStart });
  }

  // ============================================================================
  // Track Management Operations
  // ============================================================================

  /**
   * Create a new track for a timeline
   * @param timelineId Timeline ID
   * @param name Optional track name (defaults to "Track {layer}")
   * @returns The created track
   */
  async createTrack(
    timelineId: string,
    name?: string
  ): Promise<TimelineTrackRecord> {
    // Get the maximum layer number for this timeline
    const maxLayer = await this.timelineTrackMutator.getMaxLayer(timelineId);
    const nextLayer = maxLayer + 1;

    // Generate default name if not provided
    const trackName = name || `Track ${nextLayer}`;

    // Create the track
    return this.timelineTrackMutator.create({
      TimelineRef: timelineId,
      name: trackName,
      layer: nextLayer,
    });
  }

  /**
   * Update a track
   * @param trackId Track ID
   * @param data Partial track data to update
   * @returns The updated track
   */
  async updateTrack(
    trackId: string,
    data: Partial<TimelineTrackRecord>
  ): Promise<TimelineTrackRecord> {
    return this.timelineTrackMutator.update(trackId, data);
  }

  /**
   * Delete a track
   * @param trackId Track ID
   * @param deleteClips If true, delete all clips on this track; if false, reject if track has clips
   */
  async deleteTrack(trackId: string, deleteClips = false): Promise<void> {
    // Get the track to find its timeline
    const track = await this.timelineTrackMutator.getById(trackId);
    if (!track) {
      throw new Error(`Track not found: ${trackId}`);
    }

    // Get all clips on this track
    const allClips = await this.timelineClipMutator.getByTimeline(
      track.TimelineRef
    );
    const trackClips = allClips.filter((c) => c.TimelineTrackRef === trackId);

    if (trackClips.length > 0 && !deleteClips) {
      throw new Error(
        `Cannot delete track with clips. Set deleteClips=true to force deletion.`
      );
    }

    // Delete clips if requested
    if (deleteClips && trackClips.length > 0) {
      await Promise.all(
        trackClips.map((clip) => this.timelineClipMutator.delete(clip.id))
      );
    }

    // Delete the track
    await this.timelineTrackMutator.delete(trackId);
  }

  // ============================================================================
  // Render Task Creation
  // ============================================================================

  /**
   * Create a render task for a timeline
   * @param timelineId Timeline ID
   * @param config Output settings for the render
   * @param userId Optional user ID (defaults to authenticated user from pb.authStore)
   * @returns The created task
   */
  async createRenderTask(
    timelineId: string,
    config: RenderFlowConfig,
    userId?: string
  ): Promise<Task> {
    // Validate timeline
    const validationResult = await this.validateTimeline(timelineId);
    if (!validationResult.valid) {
      const errorMessages = validationResult.errors
        .map((e) => e.message)
        .join('; ');
      throw new Error(`Timeline validation failed: ${errorMessages}`);
    }

    // Get timeline
    const timeline = await this.timelineMutator.getById(timelineId);
    if (!timeline) {
      throw new Error(`Timeline not found: ${timelineId}`);
    }

    // Generate tracks (implicit track generation handled inside helper)
    const tracks = await this.generateTracks(timelineId);

    // Get current user ID - use provided userId or fall back to authStore
    const currentUserId = userId || this.pb.authStore.record?.id;
    if (!currentUserId) {
      throw new Error('User must be authenticated to create render tasks');
    }

    // Create task payload
    const payload = {
      timelineId,
      version: timeline.version || 0,
      tracks,
      outputSettings: config,
    };

    // Create task
    return this.taskMutator.createRenderTimelineTask(
      timeline.WorkspaceRef,
      currentUserId,
      timelineId,
      payload
    );
  }
}

/**
 * Create a TimelineService instance from a PocketBase client
 */
export function createTimelineService(pb: TypedPocketBase): TimelineService {
  return new TimelineService(pb);
}
