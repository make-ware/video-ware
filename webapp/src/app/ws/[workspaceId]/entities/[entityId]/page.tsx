'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  mediaDisplayName,
  useAssignTrackEntity,
  useEntity,
  useEntityAppearances,
  useEntityWords,
  type EntityTrack,
} from '@/hooks/use-entities';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Loader2, Unlink } from 'lucide-react';
import { formatClipTime } from '@/utils/format-clip-time';

/** Appearances grouped per media, in first-appearance order. */
function groupByMedia(tracks: EntityTrack[]) {
  const groups = new Map<string, { name: string; tracks: EntityTrack[] }>();
  for (const track of tracks) {
    const group = groups.get(track.MediaRef);
    if (group) {
      group.tracks.push(track);
    } else {
      groups.set(track.MediaRef, {
        name: mediaDisplayName(track.expand?.MediaRef) || track.MediaRef,
        tracks: [track],
      });
    }
  }
  return [...groups.entries()].map(([mediaId, group]) => ({
    mediaId,
    ...group,
  }));
}

/**
 * One entity: where it appears (linked tracks, per media) and everything it
 * said (speaker labels attributed to it), across the whole workspace.
 */
export default function EntityDetailPage() {
  const params = useParams();
  const workspaceId = params.workspaceId as string;
  const entityId = params.entityId as string;

  const { entity, isLoading } = useEntity(entityId);
  const { tracks, isLoading: tracksLoading } = useEntityAppearances(entityId);
  const { utterances, isLoading: wordsLoading } = useEntityWords(entityId);
  const unlink = useAssignTrackEntity();

  const mediaGroups = useMemo(() => groupByMedia(tracks), [tracks]);

  if (isLoading) {
    return (
      <div className="flex justify-center p-8">
        <Loader2 className="animate-spin h-8 w-8 text-primary" />
      </div>
    );
  }

  if (!entity) {
    return (
      <div className="container mx-auto p-6 text-muted-foreground">
        Entity not found.
      </div>
    );
  }

  const aliases = Array.isArray(entity.aliases)
    ? (entity.aliases as string[])
    : [];

  return (
    <div className="container mx-auto p-6 space-y-4">
      <Link
        href={`/ws/${workspaceId}/entities`}
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4 mr-1" />
        All entities
      </Link>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3 flex-wrap">
            <CardTitle>{entity.name}</CardTitle>
            <Badge variant="outline" className="capitalize">
              {String(entity.kind)}
            </Badge>
            {aliases.map((alias) => (
              <Badge key={alias} variant="secondary">
                {alias}
              </Badge>
            ))}
          </div>
          <CardDescription>
            {entity.description || 'No description'} · appears in{' '}
            {mediaGroups.length} {mediaGroups.length === 1 ? 'media' : 'media'}{' '}
            via {tracks.length} linked{' '}
            {tracks.length === 1 ? 'track' : 'tracks'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="appearances">
            <TabsList>
              <TabsTrigger value="appearances">Appearances</TabsTrigger>
              <TabsTrigger value="words">Words</TabsTrigger>
            </TabsList>

            <TabsContent value="appearances" className="mt-4 space-y-4">
              {tracksLoading ? (
                <Loader2 className="animate-spin h-6 w-6 text-primary mx-auto" />
              ) : mediaGroups.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">
                  Nothing linked yet. Open a media&apos;s labels and link a face
                  track or speaker to this entity.
                </p>
              ) : (
                mediaGroups.map((group) => (
                  <div key={group.mediaId} className="border rounded-lg">
                    <div className="px-4 py-2 border-b bg-muted/30 flex items-center justify-between">
                      <Link
                        href={`/ws/${workspaceId}/media/${group.mediaId}/labels`}
                        className="font-medium hover:underline truncate"
                      >
                        {group.name}
                      </Link>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {group.tracks.length}{' '}
                        {group.tracks.length === 1 ? 'track' : 'tracks'}
                      </span>
                    </div>
                    <div className="divide-y">
                      {group.tracks.map((track) => {
                        const labelType =
                          track.expand?.LabelEntityRef?.labelType;
                        const viaCluster = track.EntityRef !== entityId;
                        return (
                          <div
                            key={track.id}
                            className="px-4 py-2 flex items-center justify-between gap-3 text-sm"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <Badge
                                variant="outline"
                                className="capitalize shrink-0"
                              >
                                {Array.isArray(labelType)
                                  ? labelType.join(', ')
                                  : labelType || 'track'}
                              </Badge>
                              <span className="font-mono text-xs text-muted-foreground truncate">
                                {track.trackId}
                              </span>
                              <span className="font-mono text-xs">
                                {formatClipTime(track.start)} –{' '}
                                {formatClipTime(track.end)}
                              </span>
                              {viaCluster && (
                                <span className="text-xs text-muted-foreground">
                                  via cluster
                                </span>
                              )}
                            </div>
                            {!viaCluster && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="shrink-0 h-7"
                                disabled={unlink.isPending}
                                onClick={() =>
                                  unlink.mutate({
                                    trackId: track.id,
                                    entityId: null,
                                  })
                                }
                                title="Remove this link"
                              >
                                <Unlink className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </TabsContent>

            <TabsContent value="words" className="mt-4">
              {wordsLoading ? (
                <Loader2 className="animate-spin h-6 w-6 text-primary mx-auto" />
              ) : utterances.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">
                  No spoken words attributed yet. Link this entity to a speaker
                  in a media&apos;s Speakers → Identify tab.
                </p>
              ) : (
                <div className="space-y-3">
                  {utterances.map((u) => (
                    <div
                      key={u.id}
                      className="flex items-start gap-3 p-3 border rounded-lg"
                    >
                      <div className="w-40 shrink-0 space-y-1">
                        <Link
                          href={`/ws/${workspaceId}/media/${u.MediaRef}/labels/speakers`}
                          className="text-xs font-medium hover:underline block truncate"
                        >
                          {mediaDisplayName(u.expand?.MediaRef) || u.MediaRef}
                        </Link>
                        <div className="text-xs font-mono text-muted-foreground">
                          {formatClipTime(u.start)} – {formatClipTime(u.end)}
                        </div>
                      </div>
                      <p className="text-sm leading-relaxed flex-1">
                        {u.transcript}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
