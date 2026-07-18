'use client';

import Link from 'next/link';
import type { Entity, EntityKind } from '@project/shared';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { FilmstripViewer } from '@/components/filmstrip/filmstrip-viewer';
import { TrackCropThumb } from '@/components/labels/track-crop-thumb';
import type { EntityCardThumb } from '@/hooks/use-entities';
import { ENTITY_KIND_META } from './entity-kind';

/**
 * One entity on the entities home page: a banner image of the entity (its
 * representative track's bbox crop, or the media frame at the track midpoint
 * for tracks without boxes, or the kind icon) above its identity.
 * `thumbTrack` is undefined while the page's thumb fetch is in flight.
 */
export function EntityCard({
  workspaceId,
  entity,
  thumbTrack,
}: {
  workspaceId: string;
  entity: Entity;
  thumbTrack?: EntityCardThumb | null;
}) {
  const meta = ENTITY_KIND_META[entity.kind as EntityKind];
  const Icon = meta.icon;
  const aliases = Array.isArray(entity.aliases)
    ? (entity.aliases as string[])
    : [];

  const track = thumbTrack ?? null;
  const media = track?.expand?.MediaRef ?? null;
  const canPreview =
    !!track && !!media && (media.filmstripFileRefs?.length ?? 0) > 0;
  const hasBbox =
    !!track && Array.isArray(track.keyframes) && track.keyframes.length > 0;

  return (
    <Link
      href={`/ws/${workspaceId}/entities/${entity.id}`}
      className="group block h-full"
    >
      <Card className="h-full overflow-hidden py-0 gap-0 transition-colors hover:border-primary/50">
        <div className="relative aspect-video bg-muted/40">
          {canPreview && hasBbox ? (
            <TrackCropThumb
              media={media}
              track={track}
              displayAspect={16 / 9}
              className="absolute inset-0 h-full w-full"
            />
          ) : canPreview ? (
            <FilmstripViewer
              media={media}
              currentTime={(track.start + track.end) / 2}
              className="absolute inset-0 h-full w-full"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <Icon className="h-10 w-10 text-muted-foreground/40" />
            </div>
          )}
        </div>
        <CardContent className="p-3">
          <div className="min-w-0 space-y-0.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="font-medium truncate">{entity.name}</span>
              {aliases.map((alias) => (
                <Badge key={alias} variant="secondary" className="shrink-0">
                  {alias}
                </Badge>
              ))}
            </div>
            {entity.description && (
              <p className="text-sm text-muted-foreground truncate">
                {entity.description}
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
