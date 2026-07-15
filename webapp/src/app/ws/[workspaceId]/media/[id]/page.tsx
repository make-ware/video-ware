'use client';

import { useCallback, useMemo, useState, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useMediaDetails } from '@/hooks/use-media-details';
import { useRegisterPageMenu } from '@/hooks/use-page-menu';
import type { PageMenuItem } from '@/contexts/page-menu-context';
import { MediaVideoPlayer } from '@/components/video/media-video-player';
import { MediaClipsLibrary } from '@/components/library';
import { ClipEditorModal } from '@/components/clip/clip-editor-modal';
import { MediaClipPanel } from '@/components/clip/media-clip-panel';
import { MediaInfoEditor } from '@/components/media/media-info-editor';
import {
  ClipTypeFilter,
  clipTypeFilterPredicate,
} from '@/components/clip/clip-type-filter';
import { Button } from '@/components/ui/button';
import {
  ArrowLeft,
  RefreshCw,
  Calendar,
  Clock,
  Scissors,
  Eye,
  Info,
  Tag,
  RotateCcw,
} from 'lucide-react';
import {
  MediaTypeBadge,
  MediaTypeIcon,
  getMediaTypeLabel,
} from '@/components/media';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { SpeakerTranscriptPanel } from '@/components/labels/speakers/speaker-transcript-panel';
import { useMediaSpeakers } from '@/hooks/use-media-speakers';
import { MediaClip } from '@project/shared';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { useWorkspace } from '@/hooks/use-workspace';

function MediaDetailsPageContent() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = params.id as string;
  const { media, clips, isLoading, error, refresh } = useMediaDetails(id);
  const { currentWorkspace } = useWorkspace();
  const { utterances, isLoading: isLoadingSpeakers } = useMediaSpeakers(id);
  const [clipEditorState, setClipEditorState] = useState<
    | null
    | { mode: 'create'; playhead?: number }
    | { mode: 'edit-media-clip'; clip: MediaClip; playhead?: number }
  >(null);
  const [activeTab, setActiveTab] = useState('clips');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const videoRef = useRef<HTMLVideoElement>(null);

  // Get clip ID from URL query parameter
  const clipIdFromUrl = searchParams.get('clip');

  // Derive active clip ID from URL parameter, verifying it exists in loaded clips
  const activeClipId = useMemo(() => {
    if (!clipIdFromUrl || clips.length === 0) {
      return undefined;
    }
    // Verify the clip exists in the loaded clips
    const clipExists = clips.some((clip) => clip.id === clipIdFromUrl);
    return clipExists ? clipIdFromUrl : undefined;
  }, [clipIdFromUrl, clips]);

  const activeClip = useMemo(
    () => clips.find((c) => c.id === activeClipId),
    [clips, activeClipId]
  );

  const filteredClips = useMemo(() => {
    const predicate = clipTypeFilterPredicate(typeFilter);
    return clips.filter((clip) => predicate(clip.type));
  }, [clips, typeFilter]);

  const handleClearClipSelection = useCallback(() => {
    const newSearchParams = new URLSearchParams(searchParams.toString());
    newSearchParams.delete('clip');
    router.push(
      `/ws/${currentWorkspace?.id}/media/${id}${newSearchParams.toString() ? `?${newSearchParams.toString()}` : ''}`,
      { scroll: false }
    );
  }, [searchParams, router, currentWorkspace?.id, id]);

  // Contribute the "reset clip" action to the nav bar Edit menu.
  const editMenuItems = useMemo<PageMenuItem[]>(
    () => [
      {
        id: 'reset-clip',
        label: 'Reset to Full Video',
        icon: RotateCcw,
        disabled: !activeClipId,
        onSelect: handleClearClipSelection,
      },
    ],
    [activeClipId, handleClearClipSelection]
  );

  useRegisterPageMenu('edit', editMenuItems);

  const handleClipSelect = (clip: MediaClip) => {
    // If clicking the same clip, toggle it off (return to full video)
    if (activeClipId === clip.id) {
      handleClearClipSelection();
    } else {
      // Update URL with clip parameter
      const newSearchParams = new URLSearchParams(searchParams.toString());
      newSearchParams.set('clip', clip.id);
      router.push(
        `/ws/${currentWorkspace?.id}/media/${id}?${newSearchParams.toString()}`,
        {
          scroll: false,
        }
      );
    }
  };

  const handleBack = () => {
    router.push(`/ws/${currentWorkspace?.id}/media`);
  };

  const handleClipUpdate = () => {
    refresh();
  };

  const handleClipDelete = () => {
    refresh();
  };

  const handleOpenCreateClip = () => {
    const video = videoRef.current;
    const playhead = video?.currentTime;
    video?.pause();
    setClipEditorState({ mode: 'create', playhead });
  };

  const handleOpenEditClip = (clipId: string) => {
    const clip = clips.find((c) => c.id === clipId);
    if (clip) {
      const video = videoRef.current;
      const playhead = video?.currentTime;
      video?.pause();
      setClipEditorState({ mode: 'edit-media-clip', clip, playhead });
    }
  };

  const handleJumpToTime = (timeInSeconds: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = timeInSeconds;
      // Optionally play the video
      videoRef.current.play().catch((err) => {
        console.warn('Failed to play video:', err);
      });
    }
  };

  const _handleViewClip = (clipId: string) => {
    // Navigate to the clip
    const newSearchParams = new URLSearchParams(searchParams.toString());
    newSearchParams.set('clip', clipId);
    router.push(
      `/ws/${currentWorkspace?.id}/media/${id}?${newSearchParams.toString()}`,
      {
        scroll: false,
      }
    );
  };

  const handleTabChange = (value: string) => {
    setActiveTab(value);
  };

  if (isLoading && !media) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (error || !media) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Button variant="ghost" className="mb-4" onClick={handleBack}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Back to Gallery
        </Button>
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>
            {error?.message || 'Media not found'}
          </AlertDescription>
        </Alert>
        <Button className="mt-4" onClick={() => refresh()}>
          <RefreshCw className="mr-2 h-4 w-4" /> Retry
        </Button>
      </div>
    );
  }

  const mediaData = (media.mediaData ?? {}) as Record<string, unknown>;
  const audioData = mediaData.audio as Record<string, unknown> | undefined;
  const isAudio = media.mediaType === 'audio';
  const isImage = media.mediaType === 'image';

  const formatChannels = (channels?: number): string => {
    if (channels === 1) return 'Mono';
    if (channels === 2) return 'Stereo';
    if (typeof channels === 'number') return `${channels} ch`;
    return 'N/A';
  };

  return (
    <div className="container mx-auto px-2 sm:px-4 py-4 sm:py-8 max-w-7xl">
      {/* Header */}
      <div className="mb-4 sm:mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleBack}
            className="shrink-0"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg sm:text-2xl font-bold flex items-center gap-2">
              <span className="truncate">
                {media.expand?.UploadRef?.name || 'Untitled Media'}
              </span>
              <MediaTypeBadge
                mediaType={media.mediaType}
                className="shrink-0 bg-secondary text-secondary-foreground"
              />
            </h1>
            <div className="text-xs sm:text-sm text-muted-foreground flex items-center gap-2 sm:gap-4 mt-1">
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {new Date(media.created).toLocaleDateString()}
              </span>
              {media.duration > 0 && (
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {media.duration.toFixed(1)}s
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex gap-2 shrink-0 w-full sm:w-auto">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 sm:flex-initial"
            onClick={() =>
              router.push(`/ws/${currentWorkspace?.id}/media/${id}/details`)
            }
          >
            <Info className="h-4 w-4 mr-2" />
            Details
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1 sm:flex-initial"
            onClick={() =>
              router.push(`/ws/${currentWorkspace?.id}/media/${id}/labels`)
            }
          >
            <Tag className="h-4 w-4 mr-2" />
            Labels
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-8">
        {/* Main Content - Player */}
        <div className="lg:col-span-2 space-y-4 sm:space-y-6">
          <Card className="overflow-hidden">
            <CardContent className="pt-3 sm:pt-4 px-3 sm:px-6 pb-4 sm:pb-6">
              <div className="space-y-3 sm:space-y-4">
                {/* Header */}
                <div className="flex items-center justify-between min-h-[2.5rem]">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Eye className="h-4 w-4 text-primary" />
                    <span className="hidden sm:inline">
                      Viewing {getMediaTypeLabel(media.mediaType)}
                    </span>
                  </div>
                </div>

                {/* Video Preview */}
                <div className="w-full aspect-video bg-black rounded-lg overflow-hidden">
                  <MediaVideoPlayer
                    media={media}
                    clip={activeClip}
                    autoPlay={false}
                    className="w-full h-full"
                    ref={videoRef}
                  />
                </div>

                {/* Create/Edit Clip Buttons */}
                <div className="flex justify-center gap-2">
                  <Button
                    variant="default"
                    onClick={handleOpenCreateClip}
                    className="gap-2 w-full sm:w-auto"
                  >
                    <Scissors className="h-4 w-4" />
                    Create Clip
                  </Button>
                  {activeClip && (
                    <Button
                      variant="outline"
                      onClick={() => handleOpenEditClip(activeClip.id)}
                      className="gap-2 w-full sm:w-auto"
                    >
                      <Scissors className="h-4 w-4" />
                      Edit Clip
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Editor-facing label + description */}
          <MediaInfoEditor media={media} onUpdate={refresh} />

          {/* Metadata Card */}
          <Card className="hidden sm:block">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <MediaTypeIcon
                  mediaType={media.mediaType}
                  className="h-5 w-5"
                />
                File Details
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground block mb-1">Type</span>
                <span className="font-medium capitalize">
                  {media.mediaType || 'N/A'}
                </span>
              </div>

              {isAudio ? (
                <>
                  <div>
                    <span className="text-muted-foreground block mb-1">
                      Codec
                    </span>
                    <span className="font-medium">
                      {(audioData?.codec as string) ||
                        (mediaData.codec as string) ||
                        'N/A'}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block mb-1">
                      Sample Rate
                    </span>
                    <span className="font-medium">
                      {audioData?.sampleRate
                        ? `${audioData.sampleRate} Hz`
                        : 'N/A'}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block mb-1">
                      Channels
                    </span>
                    <span className="font-medium">
                      {formatChannels(
                        audioData?.channels as number | undefined
                      )}
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <span className="text-muted-foreground block mb-1">
                      Dimensions
                    </span>
                    <span className="font-medium">
                      {(mediaData.width as number) ?? '—'} x{' '}
                      {(mediaData.height as number) ?? '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block mb-1">
                      Codec
                    </span>
                    <span className="font-medium">
                      {(mediaData.codec as string) || 'N/A'}
                    </span>
                  </div>
                  {!isImage && (
                    <div>
                      <span className="text-muted-foreground block mb-1">
                        FPS
                      </span>
                      <span className="font-medium">
                        {(mediaData.fps as number) || 'N/A'}
                      </span>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar - Clips and Labels */}
        <div className="lg:col-span-1">
          <Card className="lg:h-[calc(100vh-12rem)] lg:min-h-[500px] flex flex-col">
            <MediaClipPanel
              activeTab={activeTab}
              onTabChange={handleTabChange}
              clipCount={filteredClips.length}
              transcriptCount={utterances.length}
              clipsContent={
                <>
                  <div className="mb-3 flex items-center justify-between px-0">
                    <ClipTypeFilter
                      value={typeFilter}
                      onChange={setTypeFilter}
                    />
                    <span className="text-xs font-normal text-muted-foreground">
                      {filteredClips.length} found
                    </span>
                  </div>
                  <MediaClipsLibrary
                    media={media}
                    clips={filteredClips}
                    activeClipId={activeClipId}
                    onClipSelect={handleClipSelect}
                    onClipUpdate={handleClipUpdate}
                    onClipDelete={handleClipDelete}
                    onInlineEdit={handleOpenEditClip}
                  />
                </>
              }
              transcriptsContent={
                <SpeakerTranscriptPanel
                  utterances={utterances}
                  isLoading={isLoadingSpeakers}
                  mediaId={media.id}
                  workspaceId={currentWorkspace?.id || ''}
                  onSeek={handleJumpToTime}
                />
              }
            />
          </Card>
        </div>
      </div>

      {/* Clip Editor Modal */}
      {clipEditorState?.mode === 'create' && (
        <ClipEditorModal
          key="create"
          open
          onOpenChange={(open) => {
            if (!open) setClipEditorState(null);
          }}
          mode="create"
          media={media}
          initialPlayhead={clipEditorState.playhead}
          onClipCreated={() => {
            refresh();
          }}
        />
      )}
      {clipEditorState?.mode === 'edit-media-clip' && (
        <ClipEditorModal
          key={clipEditorState.clip.id}
          open
          onOpenChange={(open) => {
            if (!open) setClipEditorState(null);
          }}
          mode="edit-media-clip"
          media={media}
          clip={clipEditorState.clip}
          initialPlayhead={clipEditorState.playhead}
          onClipUpdated={() => {
            refresh();
            setClipEditorState(null);
          }}
        />
      )}
    </div>
  );
}

export default function MediaDetailsPage() {
  return <MediaDetailsPageContent />;
}
