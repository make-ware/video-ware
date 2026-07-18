'use client';

import Link from 'next/link';
import { useAssignTrackEntity } from '@/hooks/use-entities';
import { mediaDisplayName } from '@/hooks/use-entities';
import type { EntityLabelRow } from '@/hooks/use-entity-labels';
import { LabelPreview } from '@/components/labels/label-preview';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { formatClipTime } from '@/utils/format-clip-time';
import { ExternalLink, Unlink } from 'lucide-react';
import {
  entityLabelConfidence,
  type EntityLabelTypeConfig,
} from './entity-label-config';

/**
 * Detail panel for the selected label: animated preview, attribution
 * (direct track link with unlink, or read-only provider cluster), source
 * media link, and stat tiles.
 */
export function EntityLabelDetail({
  workspaceId,
  entityId,
  entityName,
  config,
  row,
}: {
  workspaceId: string;
  entityId: string;
  entityName: string;
  config: EntityLabelTypeConfig;
  row: EntityLabelRow | null;
}) {
  const unlink = useAssignTrackEntity();

  if (!row) {
    return (
      <Card className="md:col-span-2">
        <CardContent className="flex items-center justify-center h-full min-h-48 text-muted-foreground">
          Select a label to view details.
        </CardContent>
      </Card>
    );
  }

  const media = row.expand?.MediaRef;
  const track = row.expand?.LabelTrackRef;
  const cluster = row.expand?.LabelEntityRef;
  const direct = !!track && track.EntityRef === entityId;
  // Speaker/speech tracks have no bounding boxes — range filmstrip instead.
  const previewTrack =
    track && Array.isArray(track.keyframes) && track.keyframes.length > 0
      ? track
      : undefined;
  const confidence = Math.round(
    entityLabelConfidence(config.labelType, row) * 100
  );

  const tiles: Array<{ label: string; value: string }> = [
    { label: 'Start Time', value: formatClipTime(row.start) },
    { label: 'End Time', value: formatClipTime(row.end) },
    { label: 'Duration', value: `${row.duration.toFixed(2)}s` },
    { label: 'Confidence', value: `${confidence}%` },
  ];
  if (track) {
    tiles.push({ label: 'Track ID', value: track.trackId });
  }
  tiles.push(...(config.detailExtras?.(row) ?? []));

  return (
    <Card className="md:col-span-2 flex flex-col">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="flex flex-col space-y-1.5 min-w-0">
          <CardTitle className="truncate">
            {config.rowTitle(row, entityName)}
          </CardTitle>
          <CardDescription className="flex items-center gap-2">
            <Badge variant="outline" className="capitalize">
              {config.labelType}
            </Badge>
            {confidence}% confidence
          </CardDescription>
        </div>
        {media && (
          <Button asChild variant="outline" size="sm" className="shrink-0">
            <Link
              href={`/ws/${workspaceId}/media/${row.MediaRef}/labels/${config.mediaLabelsRoute}`}
            >
              <ExternalLink className="h-4 w-4 mr-1.5" />
              Open media
            </Link>
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex-1 overflow-auto pt-6 space-y-4">
        <LabelPreview
          media={media}
          track={previewTrack}
          start={row.start}
          end={row.end}
        />

        <div className="p-3 border rounded bg-muted/20 flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h4 className="text-xs font-medium uppercase text-muted-foreground mb-1">
              Attribution
            </h4>
            {direct ? (
              <p className="text-sm">
                Linked directly · track{' '}
                <span className="font-mono">{track.trackId}</span>
              </p>
            ) : (
              <p className="text-sm">
                Via cluster{' '}
                <span className="font-medium">
                  {cluster?.canonicalName ?? 'unknown'}
                </span>
                {cluster?.provider ? ` (${cluster.provider})` : ''}
              </p>
            )}
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {mediaDisplayName(media) || row.MediaRef}
            </p>
          </div>
          {direct && (
            <Button
              variant="ghost"
              size="sm"
              disabled={unlink.isPending}
              onClick={() =>
                unlink.mutate({ trackId: track.id, entityId: null })
              }
              title="Remove the entity link from this track (unlinks all of the track's labels)"
            >
              <Unlink className="h-4 w-4 mr-1.5" />
              Unlink
            </Button>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {tiles.map((tile) => (
            <div key={tile.label} className="p-3 border rounded bg-muted/20">
              <h4 className="text-xs font-medium uppercase text-muted-foreground mb-1">
                {tile.label}
              </h4>
              <p className="text-sm font-mono break-words" title={tile.value}>
                {tile.value}
              </p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
