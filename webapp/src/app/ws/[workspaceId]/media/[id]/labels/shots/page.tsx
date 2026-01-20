'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { usePocketBase } from '@/contexts/pocketbase-context';
import { LabelType, type LabelShot, type Media } from '@project/shared';
import {
  MediaClipMutator,
  type ActualizableLabel,
} from '@project/shared/mutator';
import { FilmstripViewer } from '@/components/filmstrip/filmstrip-viewer';
import { useTimeAnimation } from '@/hooks/use-time-animation';
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

type ExtendedLabelShot = LabelShot & {
  expand?: {
    MediaRef?: Media;
  };
};

export default function LabelShotsPage() {
  const { pb } = usePocketBase();
  const params = useParams();
  const mediaId = params.id as string;
  const [shots, setShots] = useState<ExtendedLabelShot[]>([]);
  const [selectedShot, setSelectedShot] = useState<ExtendedLabelShot | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);

  async function handleCreateClip() {
    if (!selectedShot || !selectedShot.expand?.MediaRef) return;
    setIsCreating(true);
    try {
      const mediaClipMutator = new MediaClipMutator(pb);
      await mediaClipMutator.createFromLabel(
        selectedShot as ActualizableLabel,
        LabelType.SHOT,
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
    async function fetchShots() {
      if (!mediaId) return;
      try {
        const records = await pb
          .collection('LabelShots')
          .getList<ExtendedLabelShot>(1, 50, {
            filter: `MediaRef = "${mediaId}" && duration >= 5 && confidence >= 0.85`,
            sort: '-duration',
            expand: 'MediaRef, MediaRef.filmstripFileRefs',
          });
        setShots(records.items);
        if (records.items.length > 0) {
          setSelectedShot(records.items[0]);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchShots();
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
          <CardTitle>Shots</CardTitle>
          <CardDescription>Detected shots/segments</CardDescription>
        </CardHeader>
        <CardContent className="flex-1 overflow-hidden p-0">
          <ScrollArea className="h-full">
            <div className="p-4 pt-0 space-y-2">
              {shots.length === 0 ? (
                <p className="text-sm text-muted-foreground p-4 text-center">
                  No shots found.
                </p>
              ) : (
                shots.map((shot) => (
                  <Button
                    key={shot.id}
                    variant={
                      selectedShot?.id === shot.id ? 'secondary' : 'ghost'
                    }
                    className="w-full justify-start text-left h-auto py-3 flex flex-col items-start gap-1"
                    onClick={() => setSelectedShot(shot)}
                  >
                    <div className="font-medium capitalize">{shot.entity}</div>
                    <div className="text-xs text-muted-foreground">
                      Confidence: {Math.round(shot.confidence * 100)}%
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
              {selectedShot?.entity || 'Select a shot'}
            </CardTitle>
            <CardDescription>
              {selectedShot?.entity || 'No shot'}
            </CardDescription>
          </div>
          {selectedShot && (
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
          {selectedShot && selectedShot.expand?.MediaRef ? (
            <div className="space-y-4">
              <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
                <LabelShotFilmstrip
                  media={selectedShot.expand.MediaRef}
                  start={selectedShot.start}
                  end={selectedShot.end}
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="p-3 border rounded bg-muted/20">
                  <h4 className="text-xs font-medium uppercase text-muted-foreground mb-1">
                    Start Time
                  </h4>
                  <p className="text-sm font-mono">
                    {selectedShot.start.toFixed(2)}s
                  </p>
                </div>
                <div className="p-3 border rounded bg-muted/20">
                  <h4 className="text-xs font-medium uppercase text-muted-foreground mb-1">
                    End Time
                  </h4>
                  <p className="text-sm font-mono">
                    {selectedShot.end.toFixed(2)}s
                  </p>
                </div>
                <div className="p-3 border rounded bg-muted/20">
                  <h4 className="text-xs font-medium uppercase text-muted-foreground mb-1">
                    Duration
                  </h4>
                  <p className="text-sm font-mono">
                    {selectedShot.duration.toFixed(2)}s
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              {selectedShot
                ? 'No media available for this shot.'
                : 'Select a shot to view details.'}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function LabelShotFilmstrip({
  media,
  start,
  end,
}: {
  media: Media;
  start: number;
  end: number;
}) {
  const currentTime = useTimeAnimation({
    start,
    end,
    enabled: true,
    loop: true,
  });

  return (
    <FilmstripViewer
      media={media}
      currentTime={currentTime}
      className="w-full h-full"
    />
  );
}
