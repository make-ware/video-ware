import type { TypedPocketBase } from '@project/shared/types';
import {
  TimelineMutator,
  TimelineClipMutator,
  TimelineTrackMutator,
  MediaClipMutator,
  MediaMutator,
  CaptionMutator,
  TimelineRenderMutator,
  LabelSpeechMutator,
} from '@project/shared/mutator';
import type {
  Timeline,
  TimelineInput,
  TimelineClip,
  TimelineClipInput,
  TimelineRender,
  ValidationResult,
  ValidationError,
  TimelineTrack,
  RenderFlowConfig,
  TimelineTrackRecord,
  LabelSpeech,
} from '@project/shared';
import { TaskStatus } from '@project/shared';
import {
  generateTracks,
  validateTimeRange,
  MAX_TIMELINE_TRACKS,
  MAX_NESTED_TIMELINE_DEPTH,
  collectNestedTimelineIds,
  computeNestedTimelineDuration,
  wouldCreateTimelineCycle,
  type NestedTimelineMap,
} from '@project/shared';

/**
 * Extended Timeline type with clips included
 */
export interface TimelineWithClips extends Timeline {
  clips: TimelineClip[];
  tracks: TimelineTrackRecord[];
  /** Clips + tracks of timelines referenced by nested-timeline clips */
  nestedTimelines?: NestedTimelineMap;
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
  private captionMutator: CaptionMutator;
  private timelineRenderMutator: TimelineRenderMutator;
  private labelSpeechMutator: LabelSpeechMutator;

  constructor(pb: TypedPocketBase) {
    this.pb = pb;
    this.timelineMutator = new TimelineMutator(pb);
    this.timelineClipMutator = new TimelineClipMutator(pb);
    this.timelineTrackMutator = new TimelineTrackMutator(pb);
    this.mediaClipMutator = new MediaClipMutator(pb);
    this.mediaMutator = new MediaMutator(pb);
    this.captionMutator = new CaptionMutator(pb);
    this.timelineRenderMutator = new TimelineRenderMutator(pb);
    this.labelSpeechMutator = new LabelSpeechMutator(pb);
  }

  /**
   * Resolve the target track for a new clip, creating a default track when
   * the timeline has none.
   */
  private async resolveTargetTrack(
    timelineId: string,
    trackId?: string
  ): Promise<string> {
    if (trackId) return trackId;

    const tracks = await this.timelineTrackMutator.getByTimeline(timelineId);
    const defaultTrack =
      tracks.items.find((t) => t.layer === 0) || tracks.items[0];
    if (defaultTrack) return defaultTrack.id;

    const newTrack = await this.timelineTrackMutator.create({
      TimelineRef: timelineId,
      name: 'Main Track',
      layer: 0,
    });
    return newTrack.id;
  }

  /**
   * Fetch clips + tracks for every timeline referenced by nested-timeline
   * clips, breadth-first through nested-in-nested references up to
   * MAX_NESTED_TIMELINE_DEPTH. `visited` seeds the ids to skip (the root
   * timeline itself, so self-references never fetch).
   */
  private async fetchNestedTimelines(
    clips: TimelineClip[],
    visited: Set<string>
  ): Promise<NestedTimelineMap> {
    const map: NestedTimelineMap = {};
    let frontier = collectNestedTimelineIds(clips).filter(
      (id) => !visited.has(id)
    );

    for (
      let depth = 0;
      frontier.length > 0 && depth < MAX_NESTED_TIMELINE_DEPTH;
      depth++
    ) {
      frontier.forEach((id) => visited.add(id));
      const results = await Promise.all(
        frontier.map(async (id) => {
          try {
            const [timeline, nestedClips, nestedTracks] = await Promise.all([
              this.timelineMutator.getById(id),
              this.timelineClipMutator.getByTimeline(id),
              this.timelineTrackMutator.getByTimeline(id),
            ]);
            if (!timeline) return null;
            return {
              id,
              data: {
                timeline,
                clips: nestedClips,
                tracks: nestedTracks.items,
              },
            };
          } catch {
            // Deleted or inaccessible source timeline: the clip stays but
            // plays/renders as nothing (missing-source, like missing media)
            return null;
          }
        })
      );

      const next: string[] = [];
      for (const result of results) {
        if (!result) continue;
        map[result.id] = result.data;
        next.push(
          ...collectNestedTimelineIds(result.data.clips).filter(
            (id) => !visited.has(id)
          )
        );
      }
      frontier = [...new Set(next)];
    }

    return map;
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
    const nestedTimelines = await this.fetchNestedTimelines(
      clips,
      new Set([id])
    );

    return {
      ...timeline,
      clips,
      tracks: tracks.items,
      nestedTimelines,
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
   * Delete timeline. PocketBase cascades the deletion to TimelineClips,
   * TimelineTracks, and TimelineRenders.
   * @param id Timeline ID
   */
  async deleteTimeline(id: string): Promise<void> {
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
    const targetTrackId = await this.resolveTargetTrack(timelineId, trackId);

    // Validate time range
    // Handle potential array type from SelectField
    const mediaType = Array.isArray(media.mediaType)
      ? media.mediaType[0]
      : (media.mediaType as string);
    if (!validateTimeRange(start, end, media.duration, mediaType)) {
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
   * Add a caption to a timeline as a caption clip
   *
   * The clip's start/end trim the caption's own cue timeline (like media
   * clips trim source media); a fresh clip spans the full caption.
   *
   * @param timelineId Timeline ID
   * @param captionId Caption ID
   * @param trackId Optional track ID (defaults to layer 0)
   * @param timelineStart Optional absolute timeline position in seconds
   * @returns The created timeline clip
   */
  async addCaptionToTimeline(
    timelineId: string,
    captionId: string,
    trackId?: string,
    timelineStart?: number
  ): Promise<TimelineClip> {
    const caption = await this.captionMutator.getById(captionId);
    if (!caption) {
      throw new Error(`Caption not found: ${captionId}`);
    }

    if (timelineStart !== undefined && timelineStart < 0) {
      throw new Error(`Invalid timelineStart: ${timelineStart}. Must be >= 0.`);
    }

    const targetTrackId = await this.resolveTargetTrack(timelineId, trackId);
    const maxOrder = await this.timelineClipMutator.getMaxOrder(timelineId);

    const input: TimelineClipInput = {
      TimelineRef: timelineId,
      TimelineTrackRef: targetTrackId,
      CaptionRef: captionId,
      order: maxOrder + 1,
      start: 0,
      end: caption.duration,
      duration: caption.duration,
      meta: { title: caption.name || caption.text },
    };

    if (timelineStart !== undefined) {
      input.timelineStart = timelineStart;
    }

    return this.timelineClipMutator.create(input);
  }

  /**
   * Content duration of a timeline (furthest placed clip end), as used for
   * nested-timeline clip trim bounds. The Timelines.duration field is only
   * refreshed on save, so it cannot be trusted here.
   */
  async getTimelineContentDuration(timelineId: string): Promise<number> {
    const [clips, tracks] = await Promise.all([
      this.timelineClipMutator.getByTimeline(timelineId),
      this.timelineTrackMutator.getByTimeline(timelineId),
    ]);
    return computeNestedTimelineDuration({ clips, tracks: tracks.items });
  }

  /**
   * Add another timeline to a timeline as a nested-timeline clip.
   *
   * The inserted timeline plays as a single clip: start/end trim its own
   * time axis (a fresh clip spans the whole timeline) and it cannot be
   * edited through the parent — only trimmed. Rejects inserts that would
   * make a timeline contain itself, directly or transitively.
   *
   * @param timelineId Timeline ID (the parent)
   * @param sourceTimelineId Timeline to insert
   * @param trackId Optional track ID (defaults to layer 0)
   * @param timelineStart Optional absolute timeline position in seconds
   * @returns The created timeline clip
   */
  async addTimelineToTimeline(
    timelineId: string,
    sourceTimelineId: string,
    trackId?: string,
    timelineStart?: number
  ): Promise<TimelineClip> {
    const sourceTimeline = await this.timelineMutator.getById(sourceTimelineId);
    if (!sourceTimeline) {
      throw new Error(`Timeline not found: ${sourceTimelineId}`);
    }

    const [sourceClips, sourceTracks] = await Promise.all([
      this.timelineClipMutator.getByTimeline(sourceTimelineId),
      this.timelineTrackMutator.getByTimeline(sourceTimelineId),
    ]);

    // Walk the source's own nested references to reject transitive cycles
    const nested = await this.fetchNestedTimelines(
      sourceClips,
      new Set([sourceTimelineId])
    );
    nested[sourceTimelineId] = {
      timeline: sourceTimeline,
      clips: sourceClips,
      tracks: sourceTracks.items,
    };
    if (wouldCreateTimelineCycle(timelineId, sourceTimelineId, nested)) {
      throw new Error(
        'Cannot insert this timeline: it would contain itself (circular reference)'
      );
    }

    const sourceDuration = computeNestedTimelineDuration(
      nested[sourceTimelineId]
    );
    if (sourceDuration <= 0) {
      throw new Error('Cannot insert an empty timeline');
    }

    if (timelineStart !== undefined && timelineStart < 0) {
      throw new Error(`Invalid timelineStart: ${timelineStart}. Must be >= 0.`);
    }

    const targetTrackId = await this.resolveTargetTrack(timelineId, trackId);
    const maxOrder = await this.timelineClipMutator.getMaxOrder(timelineId);

    const input: TimelineClipInput = {
      TimelineRef: timelineId,
      TimelineTrackRef: targetTrackId,
      SourceTimelineRef: sourceTimelineId,
      order: maxOrder + 1,
      start: 0,
      end: sourceDuration,
      duration: sourceDuration,
      meta: { title: sourceTimeline.label || sourceTimeline.name },
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
   * Remove multiple clips from a timeline in bulk
   * Uses Promise.allSettled for resilience to partial failures,
   * then reorders remaining clips to fill gaps
   */
  async bulkRemoveClipsFromTimeline(clipIds: string[]): Promise<{
    succeeded: string[];
    failed: { id: string; error: string }[];
  }> {
    if (clipIds.length === 0) return { succeeded: [], failed: [] };

    // Get the timeline ID from the first clip
    const firstClip = await this.timelineClipMutator.getById(clipIds[0]);
    if (!firstClip) {
      throw new Error(`Timeline clip not found: ${clipIds[0]}`);
    }
    const timelineId = firstClip.TimelineRef;

    // Delete all clips in parallel
    const results = await Promise.allSettled(
      clipIds.map((id) => this.timelineClipMutator.delete(id).then(() => id))
    );

    const succeeded: string[] = [];
    const failed: { id: string; error: string }[] = [];

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        succeeded.push(result.value);
      } else {
        failed.push({
          id: clipIds[index],
          error:
            result.reason instanceof Error
              ? result.reason.message
              : 'Unknown error',
        });
      }
    });

    // Reorder remaining clips to fill gaps
    if (succeeded.length > 0) {
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

    return { succeeded, failed };
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

    // Nested-timeline clips trim against the source timeline's duration
    if (clip.SourceTimelineRef) {
      const [sourceClips, sourceTracks] = await Promise.all([
        this.timelineClipMutator.getByTimeline(clip.SourceTimelineRef),
        this.timelineTrackMutator.getByTimeline(clip.SourceTimelineRef),
      ]);
      const sourceDuration = computeNestedTimelineDuration({
        clips: sourceClips,
        tracks: sourceTracks.items,
      });
      if (start < 0 || end <= start || end > sourceDuration) {
        throw new Error(
          `Invalid time range: start=${start}, end=${end}, duration=${sourceDuration}`
        );
      }
      return this.timelineClipMutator.update(timelineClipId, { start, end });
    }

    // Caption clips trim against the caption's own duration
    if (clip.CaptionRef) {
      const caption = await this.captionMutator.getById(clip.CaptionRef);
      if (!caption) {
        throw new Error(`Caption not found: ${clip.CaptionRef}`);
      }
      if (start < 0 || end <= start || end > caption.duration) {
        throw new Error(
          `Invalid time range: start=${start}, end=${end}, duration=${caption.duration}`
        );
      }
      return this.timelineClipMutator.update(timelineClipId, { start, end });
    }

    if (!clip.MediaRef) {
      throw new Error(`Timeline clip has no media: ${timelineClipId}`);
    }

    // Get the media to validate time range
    const media = await this.mediaMutator.getById(clip.MediaRef);
    if (!media) {
      throw new Error(`Media not found: ${clip.MediaRef}`);
    }

    // Validate time range
    // Handle potential array type from SelectField
    const mediaType = Array.isArray(media.mediaType)
      ? media.mediaType[0]
      : (media.mediaType as string);
    if (!validateTimeRange(start, end, media.duration, mediaType)) {
      throw new Error(
        `Invalid time range: start=${start}, end=${end}, duration=${media.duration}`
      );
    }

    // Update the clip
    return this.timelineClipMutator.update(timelineClipId, { start, end });
  }

  /**
   * Apply the truncations computed for an overwrite-style insert: trim
   * overlapped clips (pinning their timeline position) and remove clips the
   * insert fully covers.
   */
  async applyClipTruncations(
    trims: Array<{
      clipId: string;
      start: number;
      end: number;
      timelineStart: number;
    }>,
    removals: string[]
  ): Promise<void> {
    await Promise.all(
      trims.map(({ clipId, start, end, timelineStart }) =>
        this.timelineClipMutator.update(clipId, {
          start,
          end,
          duration: end - start,
          timelineStart,
        })
      )
    );

    if (removals.length > 0) {
      await this.bulkRemoveClipsFromTimeline(removals);
    }
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
    const nestedTimelines = await this.fetchNestedTimelines(
      clips,
      new Set([timelineId])
    );

    // Generate tracks
    const tracks = generateTracks(clips, tracksList.items, {
      nestedTimelines,
      rootTimelineId: timelineId,
    });

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
    const nestedTimelines = await this.fetchNestedTimelines(
      clips,
      new Set([timelineId])
    );
    return generateTracks(clips, tracks.items, {
      nestedTimelines,
      rootTimelineId: timelineId,
    });
  }

  /**
   * Fetch LabelSpeech transcripts for a set of media, keyed by media id.
   * Used to burn auto-captions into renders (generateTracks derives single-line
   * cues from each media's word timings).
   */
  private async getTranscriptsByMedia(
    mediaIds: string[]
  ): Promise<Record<string, LabelSpeech[]>> {
    const entries = await Promise.all(
      mediaIds.map(async (mediaId) => {
        try {
          const result = await this.labelSpeechMutator.getByMedia(
            mediaId,
            1,
            500
          );
          return [mediaId, result.items] as const;
        } catch {
          return [mediaId, [] as LabelSpeech[]] as const;
        }
      })
    );
    return Object.fromEntries(entries.filter(([, items]) => items.length > 0));
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
      // Caption clips validate against their caption instead of media
      if (clip.CaptionRef) {
        const captionRecord = await this.captionMutator.getById(
          clip.CaptionRef
        );
        if (!captionRecord) {
          errors.push({
            code: 'INVALID_CAPTION_REF',
            message: `Timeline clip references non-existent caption: ${clip.CaptionRef}`,
            itemId: clip.id,
            itemType: 'timelineClip',
            field: 'CaptionRef',
            actual: clip.CaptionRef,
          });
        } else if (
          clip.start < 0 ||
          clip.end <= clip.start ||
          clip.end > captionRecord.duration
        ) {
          errors.push({
            code: 'OFFSET_OUT_OF_BOUNDS',
            message: `Timeline clip time range exceeds caption duration`,
            itemId: clip.id,
            itemType: 'timelineClip',
            field: 'timeRange',
            expected: `0 <= start < end <= ${captionRecord.duration}`,
            actual: { start: clip.start, end: clip.end },
          });
        }
        continue;
      }

      // Nested-timeline clips validate against their source timeline
      if (clip.SourceTimelineRef) {
        const sourceTimeline = await this.timelineMutator
          .getById(clip.SourceTimelineRef)
          .catch(() => null);
        if (!sourceTimeline) {
          errors.push({
            code: 'INVALID_SOURCE_TIMELINE_REF',
            message: `Timeline clip references non-existent timeline: ${clip.SourceTimelineRef}`,
            itemId: clip.id,
            itemType: 'timelineClip',
            field: 'SourceTimelineRef',
            actual: clip.SourceTimelineRef,
          });
          continue;
        }
        const [sourceClips, sourceTracks] = await Promise.all([
          this.timelineClipMutator.getByTimeline(clip.SourceTimelineRef),
          this.timelineTrackMutator.getByTimeline(clip.SourceTimelineRef),
        ]);
        const sourceDuration = computeNestedTimelineDuration({
          clips: sourceClips,
          tracks: sourceTracks.items,
        });
        if (
          clip.start < 0 ||
          clip.end <= clip.start ||
          clip.end > sourceDuration
        ) {
          errors.push({
            code: 'OFFSET_OUT_OF_BOUNDS',
            message: `Timeline clip time range exceeds source timeline duration`,
            itemId: clip.id,
            itemType: 'timelineClip',
            field: 'timeRange',
            expected: `0 <= start < end <= ${sourceDuration}`,
            actual: { start: clip.start, end: clip.end },
          });
        }
        continue;
      }

      if (!clip.MediaRef) {
        errors.push({
          code: 'INVALID_MEDIA_REF',
          message: `Timeline clip has neither media nor caption reference`,
          itemId: clip.id,
          itemType: 'timelineClip',
          field: 'MediaRef',
        });
        continue;
      }

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
      // Handle potential array type from SelectField
      const mediaType = Array.isArray(media.mediaType)
        ? media.mediaType[0]
        : (media.mediaType as string);
      if (!validateTimeRange(clip.start, clip.end, media.duration, mediaType)) {
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
    // Cap track count: the preview player runs one <video> per track
    const existingTracks =
      await this.timelineTrackMutator.getByTimeline(timelineId);
    if (existingTracks.items.length >= MAX_TIMELINE_TRACKS) {
      throw new Error(
        `Timelines support a maximum of ${MAX_TIMELINE_TRACKS} tracks`
      );
    }

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
   * Create a render for a timeline.
   *
   * Creates a TimelineRender entity carrying the render input (timelineData +
   * outputSettings). A PocketBase hook turns this into a `render_timeline` task,
   * and the worker fills in the output file + status on the same record. The
   * returned entity id is stable from the start, so the UI can track progress.
   *
   * @param timelineId Timeline ID
   * @param config Output settings for the render
   * @param userId Optional user ID (defaults to authenticated user from pb.authStore)
   * @returns The created TimelineRender record
   */
  async createRenderTask(
    timelineId: string,
    config: RenderFlowConfig,
    userId?: string
  ): Promise<TimelineRender> {
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

    // Generate tracks, feeding each media clip's transcripts so the renderer
    // can burn auto-captions in alongside custom caption clips (gated by the
    // includeCaptions toggle).
    const clips = await this.timelineClipMutator.getByTimeline(timelineId);
    const tracksList =
      await this.timelineTrackMutator.getByTimeline(timelineId);
    const nestedTimelines = await this.fetchNestedTimelines(
      clips,
      new Set([timelineId])
    );
    // Include media inside nested timelines so their transcripts burn in too
    const allClips = [
      ...clips,
      ...Object.values(nestedTimelines).flatMap((n) => n.clips),
    ];
    const mediaIds = [
      ...new Set(
        allClips.filter((c) => c.MediaRef).map((c) => c.MediaRef as string)
      ),
    ];
    const transcriptsByMedia =
      config.includeCaptions === false
        ? {}
        : await this.getTranscriptsByMedia(mediaIds);
    const tracks = generateTracks(clips, tracksList.items, {
      transcriptsByMedia,
      includeCaptions: config.includeCaptions,
      nestedTimelines,
      rootTimelineId: timelineId,
    });

    // Get current user ID - use provided userId or fall back to authStore
    const currentUserId = userId || this.pb.authStore.record?.id;
    if (!currentUserId) {
      throw new Error('User must be authenticated to create renders');
    }

    return this.timelineRenderMutator.create({
      TimelineRef: timelineId,
      WorkspaceRef: timeline.WorkspaceRef,
      UserRef: currentUserId,
      version: timeline.version || 0,
      timelineData: tracks,
      outputSettings: config,
      status: TaskStatus.QUEUED,
      progress: 1,
    });
  }
}

/**
 * Create a TimelineService instance from a PocketBase client
 */
export function createTimelineService(pb: TypedPocketBase): TimelineService {
  return new TimelineService(pb);
}
