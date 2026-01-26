/**
 * Track generation utilities for timeline-to-render conversion
 *
 * Generates the tracks array for render tasks from timeline clips.
 */

import type { TimelineTrack, TimelineSegment } from '../types/task-contracts';
import type { TimelineClip } from '../schema/timeline-clip';

/**
 * Validation result for validation
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Validation error details
 */
export interface ValidationError {
  code: string;
  message: string;
  itemId?: string;
  itemType?: 'timeline' | 'timelineClip' | 'mediaClip' | 'media';
  field?: string;
  expected?: unknown;
  actual?: unknown;
}

/**
 * Generate Tracks from timeline clips
 *
 * Converts TimelineClip records into a multi-track structure suitable for rendering.
 * Currently maps all clips to a single video track (Layer 0).
 * Future updates can separate tracks based on clip metadata (e.g. audio clips, overlay clips).
 *
 * @param timelineClips - Array of TimelineClip records (should be sorted by order)
 * @returns Array of TimelineTrack objects
 */
import type { TimelineTrackRecord } from '../schema/timeline-track';

/**
 * Generate Tracks from timeline clips and track definitions
 *
 * Converts TimelineClip records into a multi-track structure suitable for rendering.
 *
 * @param timelineClips - Array of TimelineClip records
 * @param timelineTracks - Optional array of TimelineTrackEntity records. If not provided, assumes single track.
 * @returns Array of TimelineTrack objects (Worker format)
 */
export function generateTracks(
  timelineClips: TimelineClip[],
  timelineTracks: TimelineTrackRecord[] = []
): TimelineTrack[] {
  // Map standard tracks from entities to worker format
  const tracks: TimelineTrack[] = [];

  // Group clips by TimelineTrackRef
  const clipsByTrack = new Map<string, TimelineClip[]>();
  const clipsWithoutTrack: TimelineClip[] = [];

  for (const clip of timelineClips) {
    if (clip.TimelineTrackRef) {
      const trackClips = clipsByTrack.get(clip.TimelineTrackRef) || [];
      trackClips.push(clip);
      clipsByTrack.set(clip.TimelineTrackRef, trackClips);
    } else {
      clipsWithoutTrack.push(clip);
    }
  }

  // Process defined tracks
  for (const trackEntity of timelineTracks) {
    const trackClips = clipsByTrack.get(trackEntity.id ?? '') || [];

    // Sort clips: prioritized by timelineStart, then order (for legacy/mixed support)
    trackClips.sort((a, b) => {
      if (
        typeof a.timelineStart === 'number' &&
        typeof b.timelineStart === 'number'
      ) {
        return a.timelineStart - b.timelineStart;
      }
      return a.order - b.order;
    });

    const segments: TimelineSegment[] = [];
    let currentTimelineTime = 0;

    for (const clip of trackClips) {
      // Determine start time: use timelineStart if available, otherwise append sequentially
      // For now, if timelineStart is missing but previous clips had it, we might have gaps or overlaps.
      // Logic: If timelineStart is set, use it. Else use currentAccumulatedTime.

      const startTime =
        typeof clip.timelineStart === 'number'
          ? clip.timelineStart
          : currentTimelineTime;

      const duration = clip.end - clip.start;

      segments.push({
        id: clip.id,
        assetId: clip.MediaRef,
        type: 'video', // Assumes video for now, can be refined based on Media type
        time: {
          start: startTime,
          duration: duration,
          sourceStart: clip.start,
        },
        video: {
          opacity: trackEntity.opacity, // Apply track settings
        },
        audio: {
          volume: trackEntity.isMuted ? 0 : trackEntity.volume,
        },
      });

      // Update accumulator (assuming sequential relative to this clip)
      currentTimelineTime = startTime + duration;
    }

    tracks.push({
      id: trackEntity.id ?? `track-${trackEntity.layer}`,
      type: 'video', // Main track type
      layer: trackEntity.layer,
      segments,
    });
  }

  // Handle clips without a track (Legacy/Default behavior)
  // These go to a generated 'Layer 0' if no Layer 0 exists, or appended?
  // We'll create a default track for them.
  if (clipsWithoutTrack.length > 0) {
    clipsWithoutTrack.sort((a, b) => a.order - b.order);

    // Check if we already have a layer 0 track
    const existingLayer0 = tracks.find((t) => t.layer === 0);

    if (existingLayer0) {
      // Append to existing layer 0? Or create a special "Legacy" track?
      // For safety, let's create a separate track if layer 0 is taken, or merge if suitable.
      // Merging is complex. Let's put them in a "fallback" track at layer -1 or appended to list.
      // But the user said "update ... to work with a single track for now".
      // If we have mixed content, it's messy.
      // Assuming new system: all clips have tracks.
      // Transitional system: clips might not have tracks.
      // We will generate a default track.

      const segments: TimelineSegment[] = [];
      let currentTimelineTime = 0;

      for (const clip of clipsWithoutTrack) {
        const startTime =
          typeof clip.timelineStart === 'number'
            ? clip.timelineStart
            : currentTimelineTime;
        const duration = clip.end - clip.start;

        segments.push({
          id: clip.id,
          assetId: clip.MediaRef,
          type: 'video',
          time: {
            start: startTime,
            duration: duration,
            sourceStart: clip.start,
          },
        });
        currentTimelineTime = startTime + duration;
      }

      // If no tracks exist at all (legacy timeline), this is the main track.
      if (tracks.length === 0) {
        tracks.push({
          id: 'default-video-track',
          type: 'video',
          layer: 0,
          segments,
        });
        // Also generate audio track for these legacy clips (as per old behavior)
        const audioSegments: TimelineSegment[] = clipsWithoutTrack.map(
          (clip, idx) => {
            const vidSeg = segments[idx];
            return {
              id: `${clip.id}-audio`,
              assetId: clip.MediaRef,
              type: 'audio',
              time: vidSeg.time,
              audio: { volume: 1.0 },
            };
          }
        );
        tracks.push({
          id: 'default-audio-track',
          type: 'audio',
          layer: 0,
          segments: audioSegments,
        });

        return tracks; // Return early for legacy behavior
      } else {
        // We have tracks AND orphan clips. This shouldn't happen in a clean state.
        // Put orphans on layer 999
        tracks.push({
          id: 'orphan-clips-track',
          type: 'video',
          layer: 999,
          segments,
        });
      }
    } else {
      // No Layer 0 track exists, but we have defined tracks?
      // Treat as above (legacy behavior generation)
      const segments: TimelineSegment[] = [];
      let currentTimelineTime = 0;
      for (const clip of clipsWithoutTrack) {
        const startTime =
          typeof clip.timelineStart === 'number'
            ? clip.timelineStart
            : currentTimelineTime;
        const duration = clip.end - clip.start;
        segments.push({
          id: clip.id,
          assetId: clip.MediaRef,
          type: 'video',
          time: { start: startTime, duration, sourceStart: clip.start },
        });
        currentTimelineTime = startTime + duration;
      }

      tracks.push({
        id: 'default-video-track',
        type: 'video',
        layer: 0,
        segments,
      });
      const audioSegments: TimelineSegment[] = clipsWithoutTrack.map(
        (clip, idx) => {
          const vidSeg = segments[idx];
          return {
            id: `${clip.id}-audio`,
            assetId: clip.MediaRef,
            type: 'audio',
            time: vidSeg.time,
            audio: { volume: 1.0 },
          };
        }
      );
      tracks.push({
        id: 'default-audio-track',
        type: 'audio',
        layer: 0,
        segments: audioSegments,
      });
    }
  }

  // Create audio tracks for the Defined Tracks??
  // The old logic separated Video and Audio into two tracks for the SAME clips.
  // Ideally, a "Video" track in ffmpeg contains both if the source has both.
  // The `compose.executor.ts` handles `track.type === 'audio'`.
  // If `TimelineTrackEntity` represents a "Track" that can contain both (since it's a structural container),
  // we might need to split it into Video and Audio tracks for the renderer if the renderer expects separate tracks.
  // The renderer `compose.executor.ts`:
  // Iterates `sortedTracks`.
  // If `track.type === 'audio'`, processes audio.
  // Base video/image processing is for visual tracks.
  // Does it extract audio from visual tracks?
  // NO. `if (track.type === 'audio') { ... } else { // Visual ... }`
  // It does NOT process audio for visual tracks in the `else` block.
  // So we MUST generate a separate Audio Track for the audio component of video clips.

  const audioTracks: TimelineTrack[] = [];

  for (const trackEntity of timelineTracks) {
    // Find the corresponding video track we just created
    const vidTrack = tracks.find((t) => t.id === trackEntity.id);
    if (!vidTrack) continue;

    if (!trackEntity.isMuted) {
      const audioSegments: TimelineSegment[] = vidTrack.segments.map((seg) => ({
        id: `${seg.id}-audio`,
        assetId: seg.assetId,
        type: 'audio',
        time: seg.time,
        audio: {
          volume: trackEntity.volume, // Use track volume
        },
      }));

      audioTracks.push({
        id: `${trackEntity.id}-audio`,
        type: 'audio',
        layer: trackEntity.layer,
        segments: audioSegments,
      });
    }
  }

  return [...tracks, ...audioTracks];
}

/**
 * Validate a TimeOffset object
 *
 * @param offset - TimeOffset to validate
 * @param context - Context string for error messages
 * @param field - Field name for error messages
 * @returns Array of validation errors (empty if valid)
 */
export function validateTimeOffset(
  offset: unknown,
  context: string,
  field: string
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!offset || typeof offset !== 'object') {
    errors.push({
      code: 'INVALID_TIME_OFFSET',
      message: `${context} has invalid ${field}`,
      field,
      actual: offset,
    });
    return errors;
  }

  // Type guard: check if offset has required properties
  if (!('seconds' in offset) || !('nanos' in offset)) {
    errors.push({
      code: 'INVALID_TIME_OFFSET',
      message: `${context} has invalid ${field} (missing required properties)`,
      field,
      actual: offset,
    });
    return errors;
  }

  // Validate seconds
  if (typeof offset.seconds !== 'number') {
    errors.push({
      code: 'INVALID_SECONDS_TYPE',
      message: `${context} ${field}.seconds is not a number`,
      field: `${field}.seconds`,
      actual: offset.seconds,
    });
  } else if (!Number.isInteger(offset.seconds)) {
    errors.push({
      code: 'INVALID_SECONDS_INTEGER',
      message: `${context} ${field}.seconds is not an integer`,
      field: `${field}.seconds`,
      actual: offset.seconds,
    });
  } else if (offset.seconds < 0) {
    errors.push({
      code: 'INVALID_SECONDS_NEGATIVE',
      message: `${context} ${field}.seconds is negative`,
      field: `${field}.seconds`,
      expected: '>= 0',
      actual: offset.seconds,
    });
  }

  // Validate nanos
  if (typeof offset.nanos !== 'number') {
    errors.push({
      code: 'INVALID_NANOS_TYPE',
      message: `${context} ${field}.nanos is not a number`,
      field: `${field}.nanos`,
      actual: offset.nanos,
    });
  } else if (!Number.isInteger(offset.nanos)) {
    errors.push({
      code: 'INVALID_NANOS_INTEGER',
      message: `${context} ${field}.nanos is not an integer`,
      field: `${field}.nanos`,
      actual: offset.nanos,
    });
  } else if (offset.nanos < 0 || offset.nanos > 999_999_999) {
    errors.push({
      code: 'INVALID_NANOS_RANGE',
      message: `${context} ${field}.nanos is out of range [0, 999999999]`,
      field: `${field}.nanos`,
      expected: '[0, 999999999]',
      actual: offset.nanos,
    });
  }

  return errors;
}
