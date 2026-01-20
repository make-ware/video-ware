'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { usePocketBase } from '@/contexts/pocketbase-context';
import {
  LabelType,
  type LabelObject,
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

type ExtendedLabelObject = LabelObject & {
  expand?: {
    LabelTrackRef?: LabelTrack;
    MediaRef?: Media;
  };
};

export default function LabelObjectsPage() {
  const { pb } = usePocketBase();
  const params = useParams();
  const mediaId = params.id as string;
  const [objects, setObjects] = useState<ExtendedLabelObject[]>([]);
  const [selectedObject, setSelectedObject] =
    useState<ExtendedLabelObject | null>(null);
  const [loading, setLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);

  async function handleCreateClip() {
    if (!selectedObject || !selectedObject.expand?.MediaRef) return;
    setIsCreating(true);
    try {
      const mediaClipMutator = new MediaClipMutator(pb);
      await mediaClipMutator.createFromLabel(
        selectedObject as ActualizableLabel,
        LabelType.OBJECT,
        'inspector'
      );
      toast.success('Clip created successfully');
    } catch (err) {
      console.error(err);
      toast.error('Failed to create clip');
    } finally {
      setIsCreating(false);
    }
  }

  useEffect(() => {
    async function fetchObjects() {
      if (!mediaId) return;
      try {
        const records = await pb
          .collection('LabelObjects')
          .getList<ExtendedLabelObject>(1, 50, {
            filter: `MediaRef = "${mediaId}" && duration >= 5  && confidence >= 0.85`,
            sort: '-duration',
            expand: 'LabelTrackRef,MediaRef,MediaRef.filmstripFileRefs',
          });
        setObjects(records.items);
        if (records.items.length > 0) {
          setSelectedObject(records.items[0]);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchObjects();
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
          <CardTitle>Objects</CardTitle>
          <CardDescription>Found objects in this media</CardDescription>
        </CardHeader>
        <CardContent className="flex-1 overflow-hidden p-0">
          <ScrollArea className="h-full">
            <div className="p-4 pt-0 space-y-2">
              {objects.length === 0 ? (
                <p className="text-sm text-muted-foreground p-4 text-center">
                  No objects found.
                </p>
              ) : (
                objects.map((obj) => (
                  <Button
                    key={obj.id}
                    variant={
                      selectedObject?.id === obj.id ? 'secondary' : 'ghost'
                    }
                    className="w-full justify-start text-left h-auto py-3 flex flex-col items-start gap-1"
                    onClick={() => setSelectedObject(obj)}
                  >
                    <div className="font-medium capitalize">{obj.entity}</div>
                    <div className="text-xs text-muted-foreground">
                      Confidence: {Math.round(obj.confidence * 100)}%
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
            <CardTitle className="capitalize">
              {selectedObject?.entity || 'Select an object'}
            </CardTitle>
            <CardDescription>
              {selectedObject?.entity || 'No object'}
            </CardDescription>
          </div>
          {selectedObject && (
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
          {selectedObject &&
          selectedObject.expand?.LabelTrackRef &&
          selectedObject.expand.MediaRef ? (
            <div className="space-y-4">
              <TracksAnimator
                media={selectedObject.expand.MediaRef}
                track={selectedObject.expand.LabelTrackRef}
              />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-3 border rounded bg-muted/20">
                  <h4 className="text-xs font-medium uppercase text-muted-foreground mb-1">
                    Start Time
                  </h4>
                  <p className="text-sm font-mono">
                    {selectedObject.start.toFixed(2)}s
                  </p>
                </div>
                <div className="p-3 border rounded bg-muted/20">
                  <h4 className="text-xs font-medium uppercase text-muted-foreground mb-1">
                    End Time
                  </h4>
                  <p className="text-sm font-mono">
                    {selectedObject.end.toFixed(2)}s
                  </p>
                </div>
                <div className="p-3 border rounded bg-muted/20">
                  <h4 className="text-xs font-medium uppercase text-muted-foreground mb-1">
                    Duration
                  </h4>
                  <p className="text-sm font-mono">
                    {selectedObject.duration.toFixed(2)}s
                  </p>
                </div>
                <div className="p-3 border rounded bg-muted/20">
                  <h4 className="text-xs font-medium uppercase text-muted-foreground mb-1">
                    Track ID
                  </h4>
                  <p
                    className="text-sm font-mono truncate"
                    title={selectedObject.expand.LabelTrackRef.trackId}
                  >
                    {selectedObject.expand.LabelTrackRef.trackId}
                  </p>
                </div>
                <div className="p-3 border rounded bg-muted/20">
                  <h4 className="text-xs font-medium uppercase text-muted-foreground mb-1">
                    Frames
                  </h4>
                  <p className="text-sm font-mono">
                    {Array.isArray(
                      selectedObject.expand.LabelTrackRef.keyframes
                    )
                      ? selectedObject.expand.LabelTrackRef.keyframes.length
                      : 0}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              {selectedObject
                ? 'No track data available for this object.'
                : 'Select an object to view details.'}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
