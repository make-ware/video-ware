'use client';

import React, {
  createContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { TimelineService, type TimelineWithClips } from '@/services/timeline';
import pb from '@/lib/pocketbase-client';
import { qk } from '@/lib/query-keys';
import {
  applyClipEvent,
  applyTimelineEvent,
  applyTrackEvent,
} from '@/utils/timeline-realtime';
import { useAuth } from '@/hooks/use-auth';
import {
  RenderFlowConfig,
  TimelineOrientation,
  TimelineTrackRecord,
  TimelineTrackRecordInput,
  computeClipPlacement,
  computeTimelineDuration,
  getClipRanges,
  getClipTimelineDuration,
  getSortedTrackClips,
  planRippleInsert,
  type LabelSpeech,
  type Timeline,
  type TimelineClip,
} from '@project/shared';

/**
 * Effective [start, end) range of one clip on its track — the same placement
 * math the editor lanes and preview use. Null when the clip isn't found.
 */
function getTrackClipRange(
  trackClips: TimelineClip[],
  clipId: string
): { start: number; end: number } | null {
  const sorted = getSortedTrackClips(trackClips);
  const ranges = getClipRanges(trackClips);
  const index = sorted.findIndex((c) => c.id === clipId);
  return index >= 0 ? ranges[index] : null;
}

interface TimelineContextType {
  // Current timeline state
  timeline: TimelineWithClips | null;
  isLoading: boolean;
  error: string | null;
  hasUnsavedChanges: boolean;

  // Playback state
  currentTime: number;
  isPlaying: boolean;
  duration: number;
  setCurrentTime: React.Dispatch<React.SetStateAction<number>>;
  setIsPlaying: React.Dispatch<React.SetStateAction<boolean>>;

  // Subtitle preview: whether to overlay auto speech-to-text captions in the
  // player (default off, mirroring the render toggle), plus the transcripts
  // (keyed by media id) they're derived from. Fetched only while shown.
  showSubtitles: boolean;
  setShowSubtitles: React.Dispatch<React.SetStateAction<boolean>>;
  transcriptsByMedia: Record<string, LabelSpeech[]>;

  // Selected clip state (backward-compatible single + new multi-select)
  selectedClipId: string | null;
  setSelectedClipId: (clipId: string | null) => void;
  selectedClipIds: Set<string>;
  toggleClipSelection: (clipId: string) => void;
  selectClipRange: (clipId: string) => void;
  selectAllClips: () => void;
  clearClipSelection: () => void;
  isClipSelected: (clipId: string) => boolean;
  handleClipSelect: (clipId: string, e: React.MouseEvent) => void;
  removeSelectedClips: (ripple?: boolean) => Promise<void>;

  // Track state
  tracks: TimelineTrackRecord[];
  selectedTrackId: string | null;
  setSelectedTrackId: (trackId: string | null) => void;

  // Timeline operations
  loadTimeline: (id: string) => Promise<void>;
  saveTimeline: () => Promise<void>;
  revertChanges: () => Promise<void>;
  updateTimelineName: (name: string) => void;
  updateTimelineOrientation: (
    orientation: TimelineOrientation
  ) => Promise<void>;

  // Clip operations
  addClip: (
    mediaId: string,
    start: number,
    end: number,
    mediaClipId?: string,
    trackId?: string,
    timelineStart?: number
  ) => Promise<void>;
  addCaptionClip: (
    captionId: string,
    duration: number,
    trackId?: string,
    timelineStart?: number
  ) => Promise<void>;
  addTimelineClip: (
    sourceTimelineId: string,
    trackId?: string,
    timelineStart?: number
  ) => Promise<void>;
  removeClip: (clipId: string, ripple?: boolean) => Promise<void>;
  reorderClips: (clipOrders: { id: string; order: number }[]) => Promise<void>;
  updateClipTimes: (
    clipId: string,
    start: number,
    end: number,
    opts?: {
      /** Pin the clip's absolute timeline position in the same write */
      timelineStart?: number;
      /** Copy-on-write edit list accompanying a composite clip trim */
      segments?: Array<{ start: number; end: number }>;
    }
  ) => Promise<void>;
  updateClip: (
    clipId: string,
    data: Partial<import('@project/shared').TimelineClipInput>
  ) => Promise<void>;

  // Track operations
  createTrack: (name?: string) => Promise<void>;
  updateTrack: (
    trackId: string,
    data: Partial<TimelineTrackRecordInput>
  ) => Promise<void>;
  deleteTrack: (trackId: string, deleteClips?: boolean) => Promise<void>;

  // Clip positioning operations
  moveClipToTrack: (
    clipId: string,
    targetTrackId: string,
    timelineStart?: number
  ) => Promise<void>;
  updateClipPosition: (clipId: string, timelineStart: number) => Promise<void>;

  // Render operations
  createRenderTask: (outputSettings: RenderFlowConfig) => Promise<void>;

  // Utility
  clearError: () => void;
  refreshTimeline: () => Promise<void>;
}

const TimelineContext = createContext<TimelineContextType | undefined>(
  undefined
);

interface TimelineProviderProps {
  children: React.ReactNode;
  timelineId?: string;
}

export function TimelineProvider({
  children,
  timelineId,
}: TimelineProviderProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // State. The timeline itself lives in the TanStack Query cache (see
  // timelineQuery below); originalTimeline is the baseline snapshot from the
  // last full fetch, backing hasUnsavedChanges and revertChanges. Realtime
  // merges intentionally never touch the baseline: a remote edit is
  // persisted but uncommitted (no version bump / editList), so it should
  // light up Save exactly like a local edit does.
  const [originalTimeline, setOriginalTimeline] =
    useState<TimelineWithClips | null>(null);
  // Write-operation-in-flight flag; OR-ed with the query's initial-load
  // state into the exposed `isLoading`.
  const [isMutationLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // True while the user has an unsaved local rename in flight; realtime
  // Timelines merges then keep the cached name so a concurrent remote
  // rename can't clobber the text mid-typing.
  const nameDirtyRef = useRef(false);
  const [selectedClipIds, setSelectedClipIds] = useState<Set<string>>(
    new Set()
  );
  const lastSelectedClipRef = useRef<string | null>(null);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);

  // Create timeline service - memoized to prevent recreation
  const timelineService = useMemo(() => new TimelineService(pb), []);

  // Fetch a timeline and reset the unsaved-changes baseline. Runs on the
  // query's own fetches and on every explicit reload (loadTimeline), so the
  // baseline always matches the last full server read.
  const fetchTimeline = useCallback(
    async (id: string): Promise<TimelineWithClips> => {
      const loadedTimeline = await timelineService.getTimeline(id);
      if (!loadedTimeline) {
        throw new Error('Timeline not found');
      }
      setOriginalTimeline(structuredClone(loadedTimeline));
      nameDirtyRef.current = false;
      return loadedTimeline;
    },
    [timelineService]
  );

  const timelineQuery = useQuery({
    queryKey: qk.timelines.detail(timelineId ?? ''),
    queryFn: () => fetchTimeline(timelineId as string),
    enabled: !!timelineId,
  });
  const timeline = timelineQuery.data ?? null;

  // Update the cached timeline in place — local write-through and realtime
  // merges both funnel here. Updaters must return the SAME reference when
  // nothing changes so structural sharing skips observer notifications
  // (this is what keeps SSE echoes of our own writes render-free).
  const patchTimeline = useCallback(
    (updater: (prev: TimelineWithClips) => TimelineWithClips) => {
      if (!timelineId) return;
      queryClient.setQueryData<TimelineWithClips>(
        qk.timelines.detail(timelineId),
        (prev) => (prev ? updater(prev) : prev)
      );
    },
    [queryClient, timelineId]
  );

  // Backward-compatible derived single selection
  const selectedClipId = useMemo(() => {
    if (selectedClipIds.size === 0) return null;
    return selectedClipIds.values().next().value ?? null;
  }, [selectedClipIds]);

  const setSelectedClipId = useCallback((clipId: string | null) => {
    if (clipId === null) {
      setSelectedClipIds(new Set());
      lastSelectedClipRef.current = null;
    } else {
      setSelectedClipIds(new Set([clipId]));
      lastSelectedClipRef.current = clipId;
    }
  }, []);

  // Playback state
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // Subtitle preview state (auto speech-to-text overlay in the player)
  const [showSubtitles, setShowSubtitles] = useState(false);
  const [transcriptsByMedia, setTranscriptsByMedia] = useState<
    Record<string, LabelSpeech[]>
  >({});

  // Total duration: furthest clip end across all tracks (respects
  // timelineStart and overlapping multi-track clips)
  const duration = useMemo(() => {
    if (!timeline) return 0;
    return computeTimelineDuration(timeline.clips, timeline.tracks || []);
  }, [timeline]);

  // Get tracks from timeline
  const tracks = useMemo(() => {
    return timeline?.tracks || [];
  }, [timeline]);

  // Media ids on the timeline (own tracks + nested timelines), used to load
  // the transcripts that back the subtitle preview overlay.
  const timelineMediaIds = useMemo(() => {
    if (!timeline) return [] as string[];
    const own = timeline.clips
      .map((c) => c.MediaRef)
      .filter((id): id is string => !!id);
    const nested = Object.values(timeline.nestedTimelines ?? {}).flatMap((n) =>
      n.clips.map((c) => c.MediaRef).filter((id): id is string => !!id)
    );
    return [...new Set([...own, ...nested])];
  }, [timeline]);
  const mediaIdsKey = timelineMediaIds.join(',');

  // Fetch transcripts only while subtitles are shown; clear them when hidden so
  // the overlay never draws stale cues. Keyed on the media-id set so it doesn't
  // refetch on unrelated timeline edits.
  useEffect(() => {
    if (!showSubtitles || timelineMediaIds.length === 0) {
      setTranscriptsByMedia({});
      return;
    }
    let cancelled = false;
    timelineService
      .getTranscriptsByMedia(timelineMediaIds)
      .then((map) => {
        if (!cancelled) setTranscriptsByMedia(map);
      })
      .catch(() => {
        if (!cancelled) setTranscriptsByMedia({});
      });
    return () => {
      cancelled = true;
    };
    // timelineMediaIds is derived from mediaIdsKey; keying on the string avoids
    // refetching when the timeline object identity changes but media doesn't.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSubtitles, mediaIdsKey, timelineService]);

  // Track unsaved changes
  const hasUnsavedChanges = useMemo(() => {
    if (!timeline || !originalTimeline) return false;

    // Compare timeline name
    if (timeline.name !== originalTimeline.name) return true;

    // Compare clips (order, start, end)
    if (timeline.clips.length !== originalTimeline.clips.length) return true;

    for (let i = 0; i < timeline.clips.length; i++) {
      const current = timeline.clips[i];
      const original = originalTimeline.clips[i];

      if (
        current.id !== original.id ||
        current.order !== original.order ||
        current.start !== original.start ||
        current.end !== original.end
      ) {
        return true;
      }
    }

    return false;
  }, [timeline, originalTimeline]);

  // Initial load state comes from the query (gated on timelineId so a
  // disabled query's perpetual isPending can't flag loading); write
  // operations flip the local flag.
  const isLoading =
    isMutationLoading || (!!timelineId && timelineQuery.isPending);

  // Surface query load failures through the same error channel as ops
  const queryError = timelineQuery.error;
  const combinedError = useMemo(() => {
    if (error) return error;
    if (!queryError) return null;
    return queryError instanceof Error
      ? queryError.message
      : 'Failed to load timeline';
  }, [error, queryError]);

  // Clear error helper
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Error handler
  const handleError = useCallback((error: unknown, operation: string) => {
    console.error(`Timeline ${operation} error:`, error);
    const message =
      error instanceof Error
        ? error.message
        : `Failed to ${operation} timeline`;
    setError(message);
  }, []);

  // Load timeline by ID — forces a fresh fetch into the query cache (and,
  // via fetchTimeline, resets the unsaved-changes baseline)
  const loadTimeline = useCallback(
    async (id: string) => {
      clearError();

      try {
        await queryClient.fetchQuery({
          queryKey: qk.timelines.detail(id),
          queryFn: () => fetchTimeline(id),
          staleTime: 0,
        });
      } catch (error) {
        handleError(error, 'load');
        throw error;
      }
    },
    [queryClient, fetchTimeline, clearError, handleError]
  );

  // Refresh timeline (reload from server)
  const refreshTimeline = useCallback(async () => {
    if (!timeline) return;
    await loadTimeline(timeline.id);
  }, [timeline, loadTimeline]);

  // Save timeline
  const saveTimeline = useCallback(async () => {
    if (!timeline) {
      throw new Error('No timeline to save');
    }

    setIsLoading(true);
    clearError();

    try {
      // Save timeline (increments version, generates editList)
      await timelineService.saveTimeline(timeline.id);

      // Reload to get updated state
      await loadTimeline(timeline.id);
    } catch (error) {
      handleError(error, 'save');
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [timeline, timelineService, loadTimeline, clearError, handleError]);

  // Revert changes
  const revertChanges = useCallback(async () => {
    if (!originalTimeline) return;

    // Restore from original
    nameDirtyRef.current = false;
    patchTimeline(() => structuredClone(originalTimeline));
  }, [originalTimeline, patchTimeline]);

  // Update timeline name (local only until saved)
  const updateTimelineName = useCallback(
    (name: string) => {
      nameDirtyRef.current = true;
      patchTimeline((prev) => ({ ...prev, name }));
    },
    [patchTimeline]
  );

  // Update timeline orientation (persists immediately — view/export setting,
  // not part of the clip-edit save flow)
  const updateTimelineOrientation = useCallback(
    async (orientation: TimelineOrientation) => {
      if (!timeline) {
        throw new Error('No timeline loaded');
      }

      patchTimeline((prev) => ({ ...prev, orientation }));
      setOriginalTimeline((prev) => (prev ? { ...prev, orientation } : prev));

      try {
        await timelineService.updateTimeline(timeline.id, { orientation });
      } catch (error) {
        handleError(error, 'update orientation');
        throw error;
      }
    },
    [timeline, timelineService, patchTimeline, handleError]
  );

  // Multi-select methods
  const toggleClipSelection = useCallback((clipId: string) => {
    setSelectedClipIds((prev) => {
      const next = new Set(prev);
      if (next.has(clipId)) {
        next.delete(clipId);
      } else {
        next.add(clipId);
      }
      return next;
    });
    lastSelectedClipRef.current = clipId;
  }, []);

  const selectClipRange = useCallback(
    (clipId: string) => {
      if (!timeline || !lastSelectedClipRef.current) {
        setSelectedClipIds(new Set([clipId]));
        lastSelectedClipRef.current = clipId;
        return;
      }

      const clipIds = timeline.clips.map((c) => c.id);
      const lastIndex = clipIds.indexOf(lastSelectedClipRef.current);
      const currentIndex = clipIds.indexOf(clipId);

      if (lastIndex === -1 || currentIndex === -1) {
        setSelectedClipIds(new Set([clipId]));
        lastSelectedClipRef.current = clipId;
        return;
      }

      const start = Math.min(lastIndex, currentIndex);
      const end = Math.max(lastIndex, currentIndex);
      const rangeItems = clipIds.slice(start, end + 1);

      setSelectedClipIds((prev) => {
        const next = new Set(prev);
        for (const id of rangeItems) {
          next.add(id);
        }
        return next;
      });
    },
    [timeline]
  );

  const selectAllClips = useCallback(() => {
    if (!timeline) return;
    setSelectedClipIds(new Set(timeline.clips.map((c) => c.id)));
  }, [timeline]);

  const clearClipSelection = useCallback(() => {
    setSelectedClipIds(new Set());
    lastSelectedClipRef.current = null;
  }, []);

  const isClipSelected = useCallback(
    (clipId: string) => selectedClipIds.has(clipId),
    [selectedClipIds]
  );

  const handleClipSelect = useCallback(
    (clipId: string, e: React.MouseEvent) => {
      if (e.metaKey || e.ctrlKey) {
        toggleClipSelection(clipId);
      } else if (e.shiftKey) {
        selectClipRange(clipId);
      } else {
        setSelectedClipId(clipId);
      }
    },
    [toggleClipSelection, selectClipRange, setSelectedClipId]
  );

  const removeSelectedClips = useCallback(
    async (ripple = false) => {
      if (!timeline || selectedClipIds.size === 0) return;

      const clipIdsToRemove = Array.from(selectedClipIds);
      clearClipSelection();

      setIsLoading(true);
      clearError();

      try {
        const result = ripple
          ? await timelineService.rippleRemoveClipsFromTimeline(clipIdsToRemove)
          : await timelineService.bulkRemoveClipsFromTimeline(clipIdsToRemove);

        // Reload to get updated state
        await loadTimeline(timeline.id);

        if (result.failed.length > 0) {
          throw new Error(`Failed to delete ${result.failed.length} clip(s)`);
        }
      } catch (error) {
        handleError(error, 'remove selected clips');
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [
      timeline,
      selectedClipIds,
      timelineService,
      loadTimeline,
      clearClipSelection,
      clearError,
      handleError,
    ]
  );

  // Add clip to timeline - places after selected clip or at end of track, never overlapping
  const addClip = useCallback(
    async (
      mediaId: string,
      start: number,
      end: number,
      mediaClipId?: string,
      trackId?: string,
      timelineStart?: number
    ) => {
      if (!timeline) {
        throw new Error('No timeline loaded');
      }

      setIsLoading(true);
      clearError();

      try {
        let targetTrackId = trackId ?? selectedTrackId ?? null;
        if (!targetTrackId) {
          const defaultTrack =
            timeline.tracks.find((t) => t.layer === 0) || timeline.tracks[0];
          targetTrackId = defaultTrack?.id ?? null;
        }

        let resolvedTimelineStart = timelineStart;
        let shifted = false;

        if (resolvedTimelineStart === undefined) {
          const trackClips = (timeline.clips || []).filter(
            (c) => c.TimelineTrackRef === targetTrackId
          );
          const duration = end - start;
          const selectedTrack = selectedTrackId
            ? timeline.tracks.find((t) => t.id === selectedTrackId)
            : undefined;

          if (
            selectedTrack &&
            selectedTrack.id === targetTrackId &&
            !selectedTrack.isLocked
          ) {
            // A lane is selected: insert at the playhead, shifting the clips
            // it would overlap (and everything after) right — never trimming
            // or overwriting them
            resolvedTimelineStart = Math.max(0, currentTime);
            const moves = planRippleInsert(
              trackClips,
              resolvedTimelineStart,
              duration
            );
            if (moves.length > 0) {
              await timelineService.applyClipShifts(moves);
              shifted = true;
            }
          } else {
            resolvedTimelineStart = computeClipPlacement(
              trackClips,
              selectedClipId,
              duration
            );
          }
        }

        const newClip = await timelineService.addClipToTimeline(
          timeline.id,
          mediaId,
          start,
          end,
          mediaClipId,
          targetTrackId ?? undefined,
          resolvedTimelineStart
        );

        if (shifted) {
          // Neighboring clips changed too — reload for a consistent view
          await loadTimeline(timeline.id);
        } else {
          // Update local state
          patchTimeline((prev) => ({
            ...prev,
            clips: [...prev.clips, newClip].sort((a, b) => a.order - b.order),
          }));
        }
      } catch (error) {
        handleError(error, 'add clip');
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [
      timeline,
      timelineService,
      selectedClipId,
      selectedTrackId,
      currentTime,
      loadTimeline,
      patchTimeline,
      clearError,
      handleError,
    ]
  );

  // Add a caption clip - same placement rules as media clips
  const addCaptionClip = useCallback(
    async (
      captionId: string,
      duration: number,
      trackId?: string,
      timelineStart?: number
    ) => {
      if (!timeline) {
        throw new Error('No timeline loaded');
      }

      setIsLoading(true);
      clearError();

      try {
        let targetTrackId = trackId ?? selectedTrackId ?? null;
        if (!targetTrackId) {
          const defaultTrack =
            timeline.tracks.find((t) => t.layer === 0) || timeline.tracks[0];
          targetTrackId = defaultTrack?.id ?? null;
        }

        let resolvedTimelineStart = timelineStart;
        let shifted = false;

        if (resolvedTimelineStart === undefined) {
          const trackClips = (timeline.clips || []).filter(
            (c) => c.TimelineTrackRef === targetTrackId
          );
          const selectedTrack = selectedTrackId
            ? timeline.tracks.find((t) => t.id === selectedTrackId)
            : undefined;

          if (
            selectedTrack &&
            selectedTrack.id === targetTrackId &&
            !selectedTrack.isLocked
          ) {
            // A lane is selected: insert at the playhead, shifting the clips
            // it would overlap (and everything after) right — never trimming
            // or overwriting them
            resolvedTimelineStart = Math.max(0, currentTime);
            const moves = planRippleInsert(
              trackClips,
              resolvedTimelineStart,
              duration
            );
            if (moves.length > 0) {
              await timelineService.applyClipShifts(moves);
              shifted = true;
            }
          } else {
            resolvedTimelineStart = computeClipPlacement(
              trackClips,
              selectedClipId,
              duration
            );
          }
        }

        const newClip = await timelineService.addCaptionToTimeline(
          timeline.id,
          captionId,
          targetTrackId ?? undefined,
          resolvedTimelineStart
        );

        if (shifted) {
          // Neighboring clips changed too — reload for a consistent view
          await loadTimeline(timeline.id);
        } else {
          patchTimeline((prev) => ({
            ...prev,
            clips: [...prev.clips, newClip].sort((a, b) => a.order - b.order),
          }));
        }
      } catch (error) {
        handleError(error, 'add caption');
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [
      timeline,
      timelineService,
      selectedClipId,
      selectedTrackId,
      currentTime,
      loadTimeline,
      patchTimeline,
      clearError,
      handleError,
    ]
  );

  // Insert another timeline as a nested-timeline clip - same placement rules
  // as media clips. Always reloads so the nestedTimelines map picks up the
  // newly referenced timeline's clips/tracks for preview.
  const addTimelineClip = useCallback(
    async (
      sourceTimelineId: string,
      trackId?: string,
      timelineStart?: number
    ) => {
      if (!timeline) {
        throw new Error('No timeline loaded');
      }

      setIsLoading(true);
      clearError();

      try {
        let targetTrackId = trackId ?? selectedTrackId ?? null;
        if (!targetTrackId) {
          const defaultTrack =
            timeline.tracks.find((t) => t.layer === 0) || timeline.tracks[0];
          targetTrackId = defaultTrack?.id ?? null;
        }

        let resolvedTimelineStart = timelineStart;

        if (resolvedTimelineStart === undefined) {
          const duration =
            await timelineService.getTimelineContentDuration(sourceTimelineId);
          const trackClips = (timeline.clips || []).filter(
            (c) => c.TimelineTrackRef === targetTrackId
          );
          const selectedTrack = selectedTrackId
            ? timeline.tracks.find((t) => t.id === selectedTrackId)
            : undefined;

          if (
            selectedTrack &&
            selectedTrack.id === targetTrackId &&
            !selectedTrack.isLocked
          ) {
            // A lane is selected: insert at the playhead, shifting the clips
            // it would overlap (and everything after) right — never trimming
            // or overwriting them
            resolvedTimelineStart = Math.max(0, currentTime);
            const moves = planRippleInsert(
              trackClips,
              resolvedTimelineStart,
              duration
            );
            if (moves.length > 0) {
              await timelineService.applyClipShifts(moves);
            }
          } else {
            resolvedTimelineStart = computeClipPlacement(
              trackClips,
              selectedClipId,
              duration
            );
          }
        }

        await timelineService.addTimelineToTimeline(
          timeline.id,
          sourceTimelineId,
          targetTrackId ?? undefined,
          resolvedTimelineStart
        );

        await loadTimeline(timeline.id);
      } catch (error) {
        handleError(error, 'insert timeline');
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [
      timeline,
      timelineService,
      selectedClipId,
      selectedTrackId,
      currentTime,
      loadTimeline,
      clearError,
      handleError,
    ]
  );

  // Remove clip from timeline; ripple shifts the following clips on the
  // clip's track left to close the gap
  const removeClip = useCallback(
    async (clipId: string, ripple = false) => {
      if (!timeline) {
        throw new Error('No timeline loaded');
      }

      setIsLoading(true);
      clearError();

      try {
        if (ripple) {
          await timelineService.rippleRemoveClipsFromTimeline([clipId]);
        } else {
          await timelineService.removeClipFromTimeline(clipId);
        }

        // Reload to get updated clip orders
        await loadTimeline(timeline.id);
      } catch (error) {
        handleError(error, 'remove clip');
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [timeline, timelineService, loadTimeline, clearError, handleError]
  );

  // Reorder clips
  const reorderClips = useCallback(
    async (clipOrders: { id: string; order: number }[]) => {
      if (!timeline) {
        throw new Error('No timeline loaded');
      }

      setIsLoading(true);
      clearError();

      try {
        await timelineService.reorderClips(timeline.id, clipOrders);

        // Update local state
        patchTimeline((prev) => {
          const updatedClips = prev.clips.map((clip) => {
            const newOrder = clipOrders.find((co) => co.id === clip.id);
            return newOrder ? { ...clip, order: newOrder.order } : clip;
          });

          return {
            ...prev,
            clips: updatedClips.sort((a, b) => a.order - b.order),
          };
        });
      } catch (error) {
        handleError(error, 'reorder clips');
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [timeline, timelineService, patchTimeline, clearError, handleError]
  );

  // Update clip times (trim). Optionally pins timelineStart in the same
  // write and carries a composite clip's copy-on-write edit list. When the
  // clip's effective on-timeline range grows past its old end, the following
  // clips on its track shift right — growth never overwrites a neighbor.
  const updateClipTimes = useCallback(
    async (
      clipId: string,
      start: number,
      end: number,
      opts?: {
        timelineStart?: number;
        segments?: Array<{ start: number; end: number }>;
      }
    ) => {
      if (!timeline) {
        throw new Error('No timeline loaded');
      }

      setIsLoading(true);
      clearError();

      try {
        const clip = timeline.clips.find((c) => c.id === clipId);
        const trackClips = clip
          ? timeline.clips.filter(
              (c) =>
                (c.TimelineTrackRef || '') === (clip.TimelineTrackRef || '')
            )
          : [];
        const oldRange = clip ? getTrackClipRange(trackClips, clipId) : null;

        const updatedClip = await timelineService.updateClipTimes(
          clipId,
          start,
          end,
          opts
        );

        // Shift (never overwrite) the following clips when the resize grew
        // the clip's effective range past its old end
        let movedClips: TimelineClip[] = [];
        if (clip && oldRange) {
          const newRangeStart = opts?.timelineStart ?? oldRange.start;
          const newRangeEnd =
            newRangeStart +
            getClipTimelineDuration({ ...clip, ...updatedClip });
          const moves = planRippleInsert(
            trackClips,
            oldRange.end,
            newRangeEnd - oldRange.end,
            clipId
          );
          if (moves.length > 0) {
            movedClips = await timelineService.applyClipShifts(moves);
          }
        }

        // Update local state (merging so expansions survive)
        patchTimeline((prev) => {
          const movedById = new Map(movedClips.map((c) => [c.id, c]));
          const updatedClips = prev.clips.map((c) => {
            if (c.id === clipId) return { ...c, ...updatedClip };
            const moved = movedById.get(c.id);
            return moved ? { ...c, ...moved } : c;
          });

          return {
            ...prev,
            clips: updatedClips,
          };
        });
      } catch (error) {
        handleError(error, 'update clip times');
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [timeline, timelineService, patchTimeline, clearError, handleError]
  );

  // Update any clip property. Edits that grow the clip's effective length
  // (e.g. a segment edit restoring cut content) shift the following clips on
  // its track right instead of overlapping them.
  const updateClip = useCallback(
    async (
      clipId: string,
      data: Partial<import('@project/shared').TimelineClipInput>
    ) => {
      if (!timeline) {
        throw new Error('No timeline loaded');
      }

      setIsLoading(true);
      clearError();

      try {
        const clip = timeline.clips.find((c) => c.id === clipId);
        const trackClips = clip
          ? timeline.clips.filter(
              (c) =>
                (c.TimelineTrackRef || '') === (clip.TimelineTrackRef || '')
            )
          : [];
        const oldRange = clip ? getTrackClipRange(trackClips, clipId) : null;

        const mutator = new (
          await import('@project/shared/mutator')
        ).TimelineClipMutator(pb);
        const updatedClip = await mutator.update(
          clipId,
          data as Record<string, unknown>
        );

        // Shift (never overwrite) the following clips when the edit grew the
        // clip's effective range past its old end
        let movedClips: TimelineClip[] = [];
        if (clip && oldRange) {
          const newRangeStart =
            typeof data.timelineStart === 'number'
              ? data.timelineStart
              : oldRange.start;
          const newRangeEnd =
            newRangeStart +
            getClipTimelineDuration({ ...clip, ...updatedClip });
          const moves = planRippleInsert(
            trackClips,
            oldRange.end,
            newRangeEnd - oldRange.end,
            clipId
          );
          if (moves.length > 0) {
            movedClips = await timelineService.applyClipShifts(moves);
          }
        }

        // Update local state
        patchTimeline((prev) => {
          const movedById = new Map(movedClips.map((c) => [c.id, c]));
          const updatedClips = prev.clips.map((c) => {
            if (c.id === clipId) return { ...c, ...updatedClip };
            const moved = movedById.get(c.id);
            return moved ? { ...c, ...moved } : c;
          });
          return { ...prev, clips: updatedClips };
        });
      } catch (error) {
        handleError(error, 'update clip');
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [timeline, timelineService, patchTimeline, clearError, handleError]
  );

  // Track operations
  const createTrack = useCallback(
    async (name?: string) => {
      if (!timeline) {
        throw new Error('No timeline loaded');
      }

      setIsLoading(true);
      clearError();

      try {
        await timelineService.createTrack(timeline.id, name);

        // Reload timeline to get updated tracks
        await refreshTimeline();
      } catch (error) {
        handleError(error, 'create track');
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [timeline, timelineService, clearError, handleError, refreshTimeline]
  );

  const updateTrack = useCallback(
    async (trackId: string, data: Partial<TimelineTrackRecordInput>) => {
      if (!timeline) {
        throw new Error('No timeline loaded');
      }

      setIsLoading(true);
      clearError();

      try {
        const updatedTrack = await timelineService.updateTrack(trackId, data);

        // Update local state
        patchTimeline((prev) => {
          const updatedTracks = prev.tracks.map((track) =>
            track.id === trackId ? updatedTrack : track
          );

          return {
            ...prev,
            tracks: updatedTracks,
          };
        });
      } catch (error) {
        handleError(error, 'update track');
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [timeline, timelineService, patchTimeline, clearError, handleError]
  );

  const deleteTrack = useCallback(
    async (trackId: string, deleteClips = false) => {
      if (!timeline) {
        throw new Error('No timeline loaded');
      }

      setIsLoading(true);
      clearError();

      try {
        await timelineService.deleteTrack(trackId, deleteClips);

        // Reload timeline to get updated tracks and clips
        await refreshTimeline();
      } catch (error) {
        handleError(error, 'delete track');
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [timeline, timelineService, clearError, handleError, refreshTimeline]
  );

  // Clip positioning operations
  const moveClipToTrack = useCallback(
    async (clipId: string, targetTrackId: string, timelineStart?: number) => {
      if (!timeline) {
        throw new Error('No timeline loaded');
      }

      setIsLoading(true);
      clearError();

      try {
        const updatedClip = await timelineService.moveClipToTrack(
          clipId,
          targetTrackId,
          timelineStart
        );

        // Update local state optimistically
        patchTimeline((prev) => {
          const updatedClips = prev.clips.map((clip) =>
            clip.id === clipId ? updatedClip : clip
          );

          return {
            ...prev,
            clips: updatedClips,
          };
        });
      } catch (error) {
        handleError(error, 'move clip to track');
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [timeline, timelineService, patchTimeline, clearError, handleError]
  );

  const updateClipPosition = useCallback(
    async (clipId: string, timelineStart: number) => {
      if (!timeline) {
        throw new Error('No timeline loaded');
      }

      setIsLoading(true);
      clearError();

      try {
        const updatedClip = await timelineService.updateClipPosition(
          clipId,
          timelineStart
        );

        // Update local state optimistically
        patchTimeline((prev) => {
          const updatedClips = prev.clips.map((clip) =>
            clip.id === clipId ? updatedClip : clip
          );

          return {
            ...prev,
            clips: updatedClips,
          };
        });
      } catch (error) {
        handleError(error, 'update clip position');
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [timeline, timelineService, patchTimeline, clearError, handleError]
  );

  // Create render task
  const createRenderTask = useCallback(
    async (outputSettings: RenderFlowConfig) => {
      if (!timeline) {
        throw new Error('No timeline loaded');
      }

      if (!user?.id) {
        throw new Error('User must be authenticated to create render tasks');
      }

      setIsLoading(true);
      clearError();

      try {
        await timelineService.createRenderTask(
          timeline.id,
          outputSettings,
          user.id
        );

        await loadTimeline(timeline.id);
      } catch (error) {
        handleError(error, 'create render task');
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [timeline, timelineService, loadTimeline, clearError, handleError, user]
  );

  // Realtime: fold TimelineClips / TimelineTracks / Timelines SSE events
  // into the query cache so concurrent editors (webapp, CLI, worker)
  // converge without manual reloads. Render-loop safety: the effect's deps
  // are stable identities only, so data changes can never resubscribe; the
  // handlers touch nothing but the query cache (via same-reference-on-no-op
  // merges) and setState with functional same-reference guards.
  useEffect(() => {
    if (!timelineId) return;

    const key = qk.timelines.detail(timelineId);
    let disposed = false;
    const unsubs: Array<() => Promise<void> | void> = [];

    const merge = (fn: (t: TimelineWithClips) => TimelineWithClips) => {
      queryClient.setQueryData<TimelineWithClips>(key, (prev) =>
        prev ? fn(prev) : prev
      );
    };

    const subscriptions = [
      pb.collection('TimelineClips').subscribe<TimelineClip>(
        '*',
        (e) => {
          if (e.action === 'delete') {
            // Drop remotely deleted clips from the selection (same
            // reference when absent, so unrelated deletes don't re-render)
            setSelectedClipIds((prev) =>
              prev.has(e.record.id)
                ? new Set([...prev].filter((id) => id !== e.record.id))
                : prev
            );
          }
          merge((t) => applyClipEvent(t, e.action, e.record));
        },
        { filter: `TimelineRef = "${timelineId}"` }
      ),
      pb
        .collection('TimelineTracks')
        .subscribe<TimelineTrackRecord>(
          '*',
          (e) => merge((t) => applyTrackEvent(t, e.action, e.record)),
          { filter: `TimelineRef = "${timelineId}"` }
        ),
      pb.collection('Timelines').subscribe<Timeline>(timelineId, (e) => {
        if (e.action === 'delete') {
          setError('This timeline was deleted');
          return;
        }
        merge((t) =>
          applyTimelineEvent(t, e.action, e.record, {
            preserveName: nameDirtyRef.current,
          })
        );
      }),
    ];

    for (const promise of subscriptions) {
      promise
        .then((unsubscribe) => {
          // StrictMode / fast unmount: the effect may be cleaned up before
          // the subscribe round-trip resolves — release immediately
          if (disposed) void unsubscribe();
          else unsubs.push(unsubscribe);
        })
        .catch((err) => {
          console.error('Timeline realtime subscription failed:', err);
        });
    }

    // Events landing between the initial fetch's server read and the
    // subscriptions coming live would otherwise be lost — refetch once now
    // that we're listening.
    void Promise.all(subscriptions)
      .then(() => {
        if (!disposed) {
          return queryClient.invalidateQueries({ queryKey: key });
        }
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      for (const unsubscribe of unsubs) void unsubscribe();
    };
  }, [timelineId, queryClient]);

  const value = useMemo<TimelineContextType>(
    () => ({
      // State
      timeline,
      isLoading,
      error: combinedError,
      hasUnsavedChanges,

      // Playback state
      currentTime,
      isPlaying,
      duration,
      setCurrentTime,
      setIsPlaying,

      // Subtitle preview
      showSubtitles,
      setShowSubtitles,
      transcriptsByMedia,

      // Selected clip state
      selectedClipId,
      setSelectedClipId,
      selectedClipIds,
      toggleClipSelection,
      selectClipRange,
      selectAllClips,
      clearClipSelection,
      isClipSelected,
      handleClipSelect,
      removeSelectedClips,

      // Track state
      tracks,
      selectedTrackId,
      setSelectedTrackId,

      // Timeline operations
      loadTimeline,
      saveTimeline,
      revertChanges,
      updateTimelineName,
      updateTimelineOrientation,

      // Clip operations
      addClip,
      addCaptionClip,
      addTimelineClip,
      removeClip,
      reorderClips,
      updateClipTimes,
      updateClip,

      // Track operations
      createTrack,
      updateTrack,
      deleteTrack,

      // Clip positioning operations
      moveClipToTrack,
      updateClipPosition,

      // Render operations
      createRenderTask,

      // Utility
      clearError,
      refreshTimeline,
    }),
    [
      timeline,
      isLoading,
      combinedError,
      hasUnsavedChanges,
      currentTime,
      isPlaying,
      duration,
      showSubtitles,
      transcriptsByMedia,
      selectedClipId,
      setSelectedClipId,
      selectedClipIds,
      toggleClipSelection,
      selectClipRange,
      selectAllClips,
      clearClipSelection,
      isClipSelected,
      handleClipSelect,
      removeSelectedClips,
      tracks,
      selectedTrackId,
      loadTimeline,
      saveTimeline,
      revertChanges,
      updateTimelineName,
      updateTimelineOrientation,
      addClip,
      addCaptionClip,
      addTimelineClip,
      removeClip,
      reorderClips,
      updateClipTimes,
      updateClip,
      createTrack,
      updateTrack,
      deleteTrack,
      moveClipToTrack,
      updateClipPosition,
      createRenderTask,
      clearError,
      refreshTimeline,
    ]
  );

  return (
    <TimelineContext.Provider value={value}>
      {children}
    </TimelineContext.Provider>
  );
}

// Export the context for use in the hook
export { TimelineContext };
