'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { usePocketBase } from '@/contexts/pocketbase-context';
import {
  LabelType,
  type LabelFace,
  type LabelTrack,
  type Media,
} from '@project/shared';
import {
  MediaClipMutator,
  type ActualizableLabel,
} from '@project/shared/mutator';
import { TracksAnimator } from '@/components/labels/tracks-animator';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

type ExtendedLabelFace = LabelFace & {
  expand?: {
    LabelTrackRef?: LabelTrack;
    MediaRef?: Media;
  };
};

export default function LabelFacesPage() {
  const { pb } = usePocketBase();
  const params = useParams();
  const mediaId = params.id as string;
  const [faces, setFaces] = useState<ExtendedLabelFace[]>([]);
  const [selectedFace, setSelectedFace] = useState<ExtendedLabelFace | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);

  async function handleCreateClip() {
    if (!selectedFace || !selectedFace.expand?.MediaRef) return;
    setIsCreating(true);
    try {
      const mediaClipMutator = new MediaClipMutator(pb);
      await mediaClipMutator.createFromLabel(
        selectedFace as ActualizableLabel,
        LabelType.FACE,
        'inspector'
      );
      toast.success('Clip created and recommended');
    } catch (err) {
      console.error(err);
      toast.error('Failed to create clip');
    } finally {
      setIsCreating(false);
    }
  }

  useEffect(() => {
    async function fetchFaces() {
      if (!mediaId) return;
      try {
        const records = await pb
          .collection('LabelFaces')
          .getList<ExtendedLabelFace>(1, 50, {
            filter: `MediaRef = "${mediaId}" && duration >= 2 `,
            sort: '-duration',
            expand: 'LabelTrackRef,MediaRef,MediaRef.filmstripFileRefs',
          });
        setFaces(records.items);
        if (records.items.length > 0) {
          setSelectedFace(records.items[0]);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchFaces();
  }, [pb, mediaId]);

  if (loading) {
    return (
      <div className="flex justify-center p-8">
        <Loader2 className="animate-spin h-8 w-8 text-primary" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 h-[calc(100vh-12rem)]">
      <Card className="md:col-span-1 flex flex-col h-full">
        <CardHeader>
          <CardTitle>Faces</CardTitle>
          <CardDescription>Detected faces</CardDescription>
        </CardHeader>
        <CardContent className="flex-1 overflow-hidden p-0">
          <ScrollArea className="h-full">
            <div className="p-4 pt-0 space-y-2">
              {faces.length === 0 ? (
                <p className="text-sm text-muted-foreground p-4 text-center">
                  No faces found.
                </p>
              ) : (
                faces.map((face) => (
                  <Button
                    key={face.id}
                    variant={
                      selectedFace?.id === face.id ? 'secondary' : 'ghost'
                    }
                    className="w-full justify-start text-left h-auto py-3 flex flex-col items-start gap-1"
                    onClick={() => setSelectedFace(face)}
                  >
                    <div className="font-medium">
                      Face {face.faceId || face.id.slice(0, 8)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Confidence: {Math.round(face.avgConfidence * 100)}%
                    </div>
                  </Button>
                ))
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      <Card className="md:col-span-2 flex flex-col h-full">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div className="flex flex-col space-y-1.5">
            <CardTitle>Face Details</CardTitle>
            <CardDescription>
              {selectedFace?.faceHash || 'No face hash'}
            </CardDescription>
          </div>
          {selectedFace && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleCreateClip}
              disabled={isCreating}
            >
              {isCreating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Create Clip
            </Button>
          )}
        </CardHeader>
        <CardContent className="flex-1 overflow-auto pt-6">
          {selectedFace &&
          selectedFace.expand?.LabelTrackRef &&
          selectedFace.expand.MediaRef ? (
            <div className="space-y-4">
              <TracksAnimator
                media={selectedFace.expand.MediaRef}
                track={selectedFace.expand.LabelTrackRef}
              />

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-3 border rounded bg-muted/20">
                  <h4 className="text-xs font-medium uppercase text-muted-foreground mb-1">
                    Start Time
                  </h4>
                  <p className="text-sm font-mono">
                    {selectedFace.start.toFixed(2)}s
                  </p>
                </div>
                <div className="p-3 border rounded bg-muted/20">
                  <h4 className="text-xs font-medium uppercase text-muted-foreground mb-1">
                    End Time
                  </h4>
                  <p className="text-sm font-mono">
                    {selectedFace.end.toFixed(2)}s
                  </p>
                </div>
                <div className="p-3 border rounded bg-muted/20">
                  <h4 className="text-xs font-medium uppercase text-muted-foreground mb-1">
                    Duration
                  </h4>
                  <p className="text-sm font-mono">
                    {selectedFace.duration.toFixed(2)}s
                  </p>
                </div>
                <div className="p-3 border rounded bg-muted/20">
                  <h4 className="text-xs font-medium uppercase text-muted-foreground mb-1">
                    Track ID
                  </h4>
                  <p
                    className="text-sm font-mono truncate"
                    title={selectedFace.expand.LabelTrackRef.trackId}
                  >
                    {selectedFace.expand.LabelTrackRef.trackId}
                  </p>
                </div>
                <div className="p-3 border rounded bg-muted/20">
                  <h4 className="text-xs font-medium uppercase text-muted-foreground mb-1">
                    Frames
                  </h4>
                  <p className="text-sm font-mono">
                    {Array.isArray(selectedFace.expand.LabelTrackRef.keyframes)
                      ? selectedFace.expand.LabelTrackRef.keyframes.length
                      : 0}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="p-3 border rounded bg-muted/20">
                  <h4 className="text-xs font-medium uppercase text-muted-foreground mb-1">
                    Joy
                  </h4>
                  <p className="text-sm">
                    {selectedFace.joyLikelihood || 'Unknown'}
                  </p>
                </div>
                <div className="p-3 border rounded bg-muted/20">
                  <h4 className="text-xs font-medium uppercase text-muted-foreground mb-1">
                    Sorrow
                  </h4>
                  <p className="text-sm">
                    {selectedFace.sorrowLikelihood || 'Unknown'}
                  </p>
                </div>
                <div className="p-3 border rounded bg-muted/20">
                  <h4 className="text-xs font-medium uppercase text-muted-foreground mb-1">
                    Anger
                  </h4>
                  <p className="text-sm">
                    {selectedFace.angerLikelihood || 'Unknown'}
                  </p>
                </div>
                <div className="p-3 border rounded bg-muted/20">
                  <h4 className="text-xs font-medium uppercase text-muted-foreground mb-1">
                    Surprise
                  </h4>
                  <p className="text-sm">
                    {selectedFace.surpriseLikelihood || 'Unknown'}
                  </p>
                </div>
                <div className="p-3 border rounded bg-muted/20">
                  <h4 className="text-xs font-medium uppercase text-muted-foreground mb-1">
                    Headwear
                  </h4>
                  <p className="text-sm">
                    {selectedFace.headwearLikelihood || 'Unknown'}
                  </p>
                </div>
                <div className="p-3 border rounded bg-muted/20">
                  <h4 className="text-xs font-medium uppercase text-muted-foreground mb-1">
                    Blurred
                  </h4>
                  <p className="text-sm">
                    {selectedFace.blurredLikelihood || 'Unknown'}
                  </p>
                </div>
                <div className="p-3 border rounded bg-muted/20">
                  <h4 className="text-xs font-medium uppercase text-muted-foreground mb-1">
                    Looking at Camera
                  </h4>
                  <p className="text-sm">
                    {selectedFace.lookingAtCameraLikelihood || 'Unknown'}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              {selectedFace
                ? 'No track data available for this face.'
                : 'Select a face to view details.'}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
