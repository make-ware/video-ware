'use client';

import React, {
  createContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import { TimelineService, type TimelineWithClips } from '@/services/timeline';
import pb from '@/lib/pocketbase-client';
import { useAuth } from '@/hooks/use-auth';
import {
  RenderFlowConfig,
  TimelineOrientation,
  TimelineTrackRecord,
  TimelineTrackRecordInput,
  computeClipPlacement,
  computeTimelineDuration,
  planOverwriteAtTime,
  type LabelSpeech,
} from '@project/shared';

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
  removeSelectedClips: () => Promise<void>;

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
  removeClip: (clipId: string) => Promise<void>;
  reorderClips: (clipOrders: { id: string; order: number }[]) => Promise<void>;
  updateClipTimes: (
    clipId: string,
    start: number,
    end: number
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
  // State
  const [timeline, setTimeline] = useState<TimelineWithClips | null>(null);
  const [originalTimeline, setOriginalTimeline] =
    useState<TimelineWithClips | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedClipIds, setSelectedClipIds] = useState<Set<string>>(
    new Set()
  );
  const lastSelectedClipRef = useRef<string | null>(null);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);

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

  // Create timeline service - memoized to prevent recreation
  const timelineService = useMemo(() => new TimelineService(pb), []);

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

  // Load timeline by ID
  const loadTimeline = useCallback(
    async (id: string) => {
      setIsLoading(true);
      clearError();

      try {
        const loadedTimeline = await timelineService.getTimeline(id);

        if (!loadedTimeline) {
          throw new Error('Timeline not found');
        }

        setTimeline(loadedTimeline);
        setOriginalTimeline(structuredClone(loadedTimeline)); // Deep clone
      } catch (error) {
        handleError(error, 'load');
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [timelineService, clearError, handleError]
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
    setTimeline(structuredClone(originalTimeline));
  }, [originalTimeline]);

  // Update timeline name (local only until saved)
  const updateTimelineName = useCallback((name: string) => {
    setTimeline((prev) => {
      if (!prev) return prev;
      return { ...prev, name };
    });
  }, []);

  // Update timeline orientation (persists immediately — view/export setting,
  // not part of the clip-edit save flow)
  const updateTimelineOrientation = useCallback(
    async (orientation: TimelineOrientation) => {
      if (!timeline) {
        throw new Error('No timeline loaded');
      }

      setTimeline((prev) => (prev ? { ...prev, orientation } : prev));
      setOriginalTimeline((prev) => (prev ? { ...prev, orientation } : prev));

      try {
        await timelineService.updateTimeline(timeline.id, { orientation });
      } catch (error) {
        handleError(error, 'update orientation');
        throw error;
      }
    },
    [timeline, timelineService, handleError]
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

  const removeSelectedClips = useCallback(async () => {
    if (!timeline || selectedClipIds.size === 0) return;

    const clipIdsToRemove = Array.from(selectedClipIds);
    clearClipSelection();

    setIsLoading(true);
    clearError();

    try {
      const result =
        await timelineService.bulkRemoveClipsFromTimeline(clipIdsToRemove);

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
  }, [
    timeline,
    selectedClipIds,
    timelineService,
    loadTimeline,
    clearClipSelection,
    clearError,
    handleError,
  ]);

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
        let truncated = false;

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
            // A lane is selected: insert at the playhead, truncating overlaps
            resolvedTimelineStart = Math.max(0, currentTime);
            const plan = planOverwriteAtTime(
              trackClips,
              resolvedTimelineStart,
              duration
            );
            if (plan.trims.length > 0 || plan.removals.length > 0) {
              await timelineService.applyClipTruncations(
                plan.trims,
                plan.removals
              );
              truncated = true;
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

        if (truncated) {
          // Neighboring clips changed too — reload for a consistent view
          await loadTimeline(timeline.id);
        } else {
          // Update local state
          setTimeline((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              clips: [...prev.clips, newClip].sort((a, b) => a.order - b.order),
            };
          });
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
        let truncated = false;

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
            // A lane is selected: insert at the playhead, truncating overlaps
            resolvedTimelineStart = Math.max(0, currentTime);
            const plan = planOverwriteAtTime(
              trackClips,
              resolvedTimelineStart,
              duration
            );
            if (plan.trims.length > 0 || plan.removals.length > 0) {
              await timelineService.applyClipTruncations(
                plan.trims,
                plan.removals
              );
              truncated = true;
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

        if (truncated) {
          // Neighboring clips changed too — reload for a consistent view
          await loadTimeline(timeline.id);
        } else {
          setTimeline((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              clips: [...prev.clips, newClip].sort((a, b) => a.order - b.order),
            };
          });
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
            // A lane is selected: insert at the playhead, truncating overlaps
            resolvedTimelineStart = Math.max(0, currentTime);
            const plan = planOverwriteAtTime(
              trackClips,
              resolvedTimelineStart,
              duration
            );
            if (plan.trims.length > 0 || plan.removals.length > 0) {
              await timelineService.applyClipTruncations(
                plan.trims,
                plan.removals
              );
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

  // Remove clip from timeline
  const removeClip = useCallback(
    async (clipId: string) => {
      if (!timeline) {
        throw new Error('No timeline loaded');
      }

      setIsLoading(true);
      clearError();

      try {
        await timelineService.removeClipFromTimeline(clipId);

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
        setTimeline((prev) => {
          if (!prev) return prev;

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
    [timeline, timelineService, clearError, handleError]
  );

  // Update clip times
  const updateClipTimes = useCallback(
    async (clipId: string, start: number, end: number) => {
      if (!timeline) {
        throw new Error('No timeline loaded');
      }

      setIsLoading(true);
      clearError();

      try {
        const updatedClip = await timelineService.updateClipTimes(
          clipId,
          start,
          end
        );

        // Update local state
        setTimeline((prev) => {
          if (!prev) return prev;

          const updatedClips = prev.clips.map((clip) =>
            clip.id === clipId ? updatedClip : clip
          );

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
    [timeline, timelineService, clearError, handleError]
  );

  // Update any clip property
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
        const mutator = new (
          await import('@project/shared/mutator')
        ).TimelineClipMutator(pb);
        const updatedClip = await mutator.update(
          clipId,
          data as Record<string, unknown>
        );

        // Update local state
        setTimeline((prev) => {
          if (!prev) return prev;
          const updatedClips = prev.clips.map((clip) =>
            clip.id === clipId ? { ...clip, ...updatedClip } : clip
          );
          return { ...prev, clips: updatedClips };
        });
      } catch (error) {
        handleError(error, 'update clip');
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [timeline, clearError, handleError]
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
        setTimeline((prev) => {
          if (!prev) return prev;

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
    [timeline, timelineService, clearError, handleError]
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
        setTimeline((prev) => {
          if (!prev) return prev;

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
    [timeline, timelineService, clearError, handleError]
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
        setTimeline((prev) => {
          if (!prev) return prev;

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
    [timeline, timelineService, clearError, handleError]
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

        // Reload timeline to get updated renderTaskRef
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

  // Auto-load timeline if timelineId is provided
  useEffect(() => {
    if (timelineId) {
      loadTimeline(timelineId);
    }
  }, [timelineId, loadTimeline]);

  const value = useMemo<TimelineContextType>(
    () => ({
      // State
      timeline,
      isLoading,
      error,
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
      error,
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
