'use client';

import { useMemo, useState, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useMediaDetails } from '@/hooks/use-media-details';
import { MediaVideoPlayer } from '@/components/video/media-video-player';
import { ClipList } from '@/components/clip/clip-list';
import { InlineClipCreator } from '@/components/clip/inline-clip-creator';
import { InlineClipEditor } from '@/components/clip/inline-clip-editor';
import { MediaRecommendationsPanel } from '@/components/recommendations/media-recommendations-panel';
import { MediaRecommendationProvider } from '@/contexts/media-recommendation-context';
import { useMediaRecommendations } from '@/hooks/use-media-recommendations';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ArrowLeft,
  RefreshCw,
  Calendar,
  FileVideo,
  Clock,
  Scissors,
  Eye,
  X,
  Check,
  Sparkles,
  Info,
  Captions,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { TranscriptOverlay } from '@/components/transcripts/transcript-overlay';
import { TranscriptList } from '@/components/transcripts/transcript-list';
import { useMediaTranscripts } from '@/hooks/use-media-transcripts';
import { cn } from '@/lib/utils';
import { MediaClip, MediaRecommendation } from '@project/shared';
import { ClipType } from '@project/shared';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { MediaClipMutator } from '@project/shared/mutator';
import pb from '@/lib/pocketbase-client';
import { toast } from 'sonner';
import { useWorkspace } from '@/hooks/use-workspace';

function MediaDetailsPageContentWithRecommendations() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = params.id as string;
  const { media, clips, isLoading, error, refresh } = useMediaDetails(id);
  const { currentWorkspace } = useWorkspace();
  const {
    recommendations,
    isLoading: isLoadingRecommendations,
    generateRecommendations,
  } = useMediaRecommendations();
  const {
    transcripts,
    isLoading: _isLoadingTranscripts,
    createTranscript,
    updateTranscript,
    deleteTranscript,
    refresh: _refreshTranscripts,
  } = useMediaTranscripts(id);
  const [isInlineCreateMode, setIsInlineCreateMode] = useState(false);
  const [editingClipId, setEditingClipId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('clips');
  const [showTranscripts, setShowTranscripts] = useState(true);
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

  // Get the clip being edited
  const editingClip = useMemo(
    () => clips.find((c) => c.id === editingClipId),
    [clips, editingClipId]
  );

  const handleClipSelect = (clip: MediaClip) => {
    // If clicking the same clip, toggle it off (return to full video)
    if (activeClipId === clip.id) {
      // Remove clip parameter from URL
      const newSearchParams = new URLSearchParams(searchParams.toString());
      newSearchParams.delete('clip');
      router.push(
        `/ws/${currentWorkspace?.id}/media/${id}${newSearchParams.toString() ? `?${newSearchParams.toString()}` : ''}`,
        { scroll: false }
      );
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

  const handleInlineClipCreated = () => {
    // Refresh clips list and exit inline create mode
    refresh();
    setIsInlineCreateMode(false);
  };

  const handleInlineClipUpdated = () => {
    // Refresh clips list and exit edit mode
    refresh();
    setEditingClipId(null);
  };

  const handleClipUpdate = () => {
    // Refresh clips list
    refresh();
  };

  const handleClipDelete = () => {
    // Refresh clips list
    refresh();
  };

  const handleStartInlineCreate = () => {
    setIsInlineCreateMode(true);
    setEditingClipId(null);
  };

  const handleCancelInlineCreate = () => {
    setIsInlineCreateMode(false);
  };

  const handleStartEditClip = (clipId: string) => {
    setEditingClipId(clipId);
    setIsInlineCreateMode(false);
  };

  const handleCancelEditClip = () => {
    setEditingClipId(null);
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

  const handleCreateClipFromRecommendation = async (
    recommendation: MediaRecommendation
  ) => {
    if (!media || !currentWorkspace) {
      toast.error('Media or workspace not available');
      return;
    }

    try {
      const clipMutator = new MediaClipMutator(pb);
      await clipMutator.createFromRecommendation(
        recommendation,
        'recommendation'
      );

      toast.success('Clip created from recommendation');
      refresh(); // Refresh clips list
    } catch (error) {
      console.error('Failed to create clip from recommendation:', error);
      toast.error('Failed to create clip', {
        description:
          error instanceof Error ? error.message : 'An unknown error occurred',
      });
    }
  };

  const handlePreviewRecommendation = (recommendation: MediaRecommendation) => {
    // Jump to the start time of the recommendation
    handleJumpToTime(recommendation.start);

    // Optionally, set the time range in the video player by updating URL with a clip
    // For now, just jumping to the start time
  };

  // Handle tab change - generate recommendations when recommendations tab becomes active
  const handleTabChange = async (value: string) => {
    setActiveTab(value);

    // If switching to recommendations tab and no recommendations exist, generate them
    if (
      value === 'recommendations' &&
      (!recommendations || recommendations.length === 0)
    ) {
      if (media && currentWorkspace) {
        await generateRecommendations(media.id, currentWorkspace.id);
      }
    }
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
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Gallery
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
            <h1 className="text-lg sm:text-2xl font-bold flex items-center gap-2 truncate">
              {media.expand?.UploadRef?.name || 'Untitled Media'}
            </h1>
            <div className="text-xs sm:text-sm text-muted-foreground flex items-center gap-2 sm:gap-4 mt-1">
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {new Date(media.created).toLocaleDateString()}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {media.duration.toFixed(1)}s
              </span>
            </div>
          </div>
        </div>

        <div className="flex gap-2 shrink-0 w-full sm:w-auto">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 sm:flex-initial"
            onClick={() => {
              // Remove clip parameter from URL
              const newSearchParams = new URLSearchParams(
                searchParams.toString()
              );
              newSearchParams.delete('clip');
              router.push(
                `/ws/${currentWorkspace?.id}/media/${id}${newSearchParams.toString() ? `?${newSearchParams.toString()}` : ''}`,
                { scroll: false }
              );
            }}
            disabled={!activeClipId}
          >
            Reset to Full Video
          </Button>
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
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-8">
        {/* Main Content - Player */}
        <div className="lg:col-span-2 space-y-4 sm:space-y-6">
          {/* Inline Clip Creator Mode */}
          {isInlineCreateMode && media && (
            <Card className="overflow-hidden">
              <CardContent className="pt-3 sm:pt-4 px-3 sm:px-6 pb-4 sm:pb-6">
                <InlineClipCreator
                  media={media}
                  onClipCreated={handleInlineClipCreated}
                  onCancel={handleCancelInlineCreate}
                />
              </CardContent>
            </Card>
          )}

          {/* Inline Clip Editor Mode */}
          {editingClip && media && (
            <Card className="overflow-hidden">
              <CardContent className="pt-3 sm:pt-4 px-3 sm:px-6 pb-4 sm:pb-6">
                <InlineClipEditor
                  media={media}
                  clip={editingClip}
                  onClipUpdated={handleInlineClipUpdated}
                  onCancel={handleCancelEditClip}
                />
              </CardContent>
            </Card>
          )}

          {/* Normal Video Player (when not in inline create/edit mode) */}
          {!isInlineCreateMode && !editingClip && (
            <Card className="overflow-hidden">
              <CardContent className="pt-3 sm:pt-4 px-3 sm:px-6 pb-4 sm:pb-6">
                <div className="space-y-3 sm:space-y-4">
                  {/* Header */}
                  <div className="flex items-center justify-between min-h-[2.5rem]">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Eye className="h-4 w-4 text-primary" />
                      <span className="hidden sm:inline">Viewing Media</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled
                        className="hidden sm:flex"
                      >
                        <X className="h-4 w-4 mr-1" />
                        Cancel
                      </Button>
                      <Button size="sm" disabled className="hidden sm:flex">
                        <Check className="h-4 w-4 mr-1" />
                        Save
                      </Button>
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
                    >
                      {(currentTime) => (
                        <TranscriptOverlay
                          transcripts={transcripts}
                          currentTime={currentTime}
                          isVisible={showTranscripts}
                        />
                      )}
                    </MediaVideoPlayer>
                  </div>

                  {/* Create/Edit Clip Button */}
                  <div className="flex justify-center">
                    {activeClip ? (
                      <Button
                        variant="outline"
                        onClick={() => handleStartEditClip(activeClip.id)}
                        className="gap-2 w-full sm:w-auto"
                        disabled={activeClip.type === ClipType.FULL}
                      >
                        <Scissors className="h-4 w-4" />
                        Edit Clip
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        onClick={handleStartInlineCreate}
                        className="gap-2 w-full sm:w-auto"
                      >
                        <Scissors className="h-4 w-4" />
                        Create Clip
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Metadata Card */}
          <Card className="hidden sm:block">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <FileVideo className="h-5 w-5" />
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
              <div>
                <span className="text-muted-foreground block mb-1">
                  Dimensions
                </span>
                <span className="font-medium">
                  {
                    (media.mediaData as Record<string, unknown>)
                      ?.width as number
                  }{' '}
                  x{' '}
                  {
                    (media.mediaData as Record<string, unknown>)
                      ?.height as number
                  }
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block mb-1">Codec</span>
                <span className="font-medium">
                  {((media.mediaData as Record<string, unknown>)
                    ?.codec as string) || 'N/A'}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block mb-1">FPS</span>
                <span className="font-medium">
                  {((media.mediaData as Record<string, unknown>)
                    ?.fps as number) || 'N/A'}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar - Clips and Labels */}
        <div className="lg:col-span-1">
          <Card className="lg:h-[calc(100vh-12rem)] lg:min-h-[500px] flex flex-col">
            <Tabs
              value={activeTab}
              onValueChange={handleTabChange}
              className="flex flex-col h-full"
            >
              <CardHeader className="pb-3">
                <TabsList className="w-full">
                  <TabsTrigger value="clips" className="flex-1 gap-1.5">
                    <Scissors className="h-4 w-4" />
                    Clips
                  </TabsTrigger>
                  <TabsTrigger value="transcripts" className="flex-1 gap-1.5">
                    <Captions className="h-4 w-4" />
                    Transcripts
                  </TabsTrigger>
                  <TabsTrigger
                    value="recommendations"
                    className="flex-1 gap-1.5"
                  >
                    <Sparkles className="h-4 w-4" />
                    Recs
                  </TabsTrigger>
                </TabsList>
              </CardHeader>

              <CardContent className="flex-1 flex flex-col overflow-hidden px-0 pt-0">
                <TabsContent
                  value="clips"
                  className="flex-1 overflow-y-auto px-3 sm:px-6 max-h-[400px] lg:max-h-none mt-0"
                >
                  <div className="mb-3 flex items-center justify-between px-0">
                    <span className="text-xs sm:text-sm font-normal text-muted-foreground">
                      {clips.length} found
                    </span>
                  </div>
                  <ClipList
                    media={media}
                    clips={clips}
                    activeClipId={activeClipId}
                    onClipSelect={handleClipSelect}
                    onClipUpdate={handleClipUpdate}
                    onClipDelete={handleClipDelete}
                    onInlineEdit={handleStartEditClip}
                  />
                </TabsContent>

                <TabsContent
                  value="transcripts"
                  className="flex-1 overflow-y-auto px-3 sm:px-6 max-h-[400px] lg:max-h-none mt-0"
                >
                  <div className="mb-3 flex items-center justify-between px-0">
                    <span className="text-xs sm:text-sm font-normal text-muted-foreground">
                      {transcripts.length} found
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={cn(
                        'h-6 text-xs',
                        showTranscripts && 'bg-muted'
                      )}
                      onClick={() => setShowTranscripts(!showTranscripts)}
                    >
                      {showTranscripts ? 'Hide Overlay' : 'Show Overlay'}
                    </Button>
                  </div>
                  <TranscriptList
                    transcripts={transcripts}
                    mediaId={media.id}
                    workspaceId={currentWorkspace?.id || ''}
                    onSeek={handleJumpToTime}
                    onCreate={createTranscript}
                    onUpdate={updateTranscript}
                    onDelete={deleteTranscript}
                  />
                </TabsContent>

                <TabsContent
                  value="recommendations"
                  className="flex-1 overflow-y-auto px-3 sm:px-6 max-h-[400px] lg:max-h-none mt-0"
                >
                  <MediaRecommendationsPanel
                    recommendations={recommendations}
                    media={media}
                    isLoading={isLoadingRecommendations}
                    onCreateClip={handleCreateClipFromRecommendation}
                    onPreview={handlePreviewRecommendation}
                  />
                </TabsContent>
              </CardContent>
            </Tabs>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default function MediaDetailsPage() {
  const params = useParams();
  const id = params.id as string;

  return (
    <MediaRecommendationProvider mediaId={id}>
      <MediaDetailsPageContentWithRecommendations />
    </MediaRecommendationProvider>
  );
}
