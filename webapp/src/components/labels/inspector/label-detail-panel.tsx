'use client';

import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Loader2, Scissors } from 'lucide-react';
import { TracksAnimator } from '@/components/labels/tracks-animator';
import { FilmstripViewer } from '@/components/filmstrip/filmstrip-viewer';
import { EntityPicker } from '@/components/labels/entity/entity-picker';
import { useAssignTrackEntity } from '@/hooks/use-entities';
import { useTimeAnimation } from '@/hooks/use-time-animation';
import type { Media } from '@project/shared';
import { formatClipTime } from '@/utils/format-clip-time';
import { confidenceOf, type InspectorTypeConfig } from './config';
import type { InspectorLabelRecord } from './use-label-list';

interface LabelDetailPanelProps {
  config: InspectorTypeConfig;
  record: InspectorLabelRecord | null;
  onCreateClip: () => void;
  isCreating: boolean;
}

export function LabelDetailPanel({
  config,
  record,
  onCreateClip,
  isCreating,
}: LabelDetailPanelProps) {
  return (
    <Card className="md:col-span-2 flex flex-col h-full">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="flex flex-col space-y-1.5 min-w-0">
          <CardTitle className="capitalize truncate">
            {record ? config.listTitle(record) : `Select a label`}
          </CardTitle>
          <CardDescription>
            {record
              ? `${Math.round(confidenceOf(config, record) * 100)}% confidence`
              : `Pick a ${config.title.toLowerCase().replace(/s$/, '')} from the list`}
          </CardDescription>
        </div>
        {record && (
          <Button
            variant="default"
            size="sm"
            onClick={onCreateClip}
            disabled={isCreating}
          >
            {isCreating ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Scissors className="mr-2 h-4 w-4" />
            )}
            Create Clip
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex-1 overflow-auto pt-6">
        {record ? (
          <div className="space-y-4">
            <LabelPreview config={config} record={record} />
            <EntityLinkSection record={record} />
            <StatTiles config={config} record={record} />
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            Select a label to view details.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LabelPreview({
  config,
  record,
}: {
  config: InspectorTypeConfig;
  record: InspectorLabelRecord;
}) {
  const media = record.expand?.MediaRef;
  const track = record.expand?.LabelTrackRef;

  if (!media) {
    return (
      <div className="flex items-center justify-center aspect-video bg-muted/30 rounded-lg text-sm text-muted-foreground">
        No media preview available.
      </div>
    );
  }

  if (config.preview === 'track' && track) {
    return <TracksAnimator media={media} track={track} />;
  }

  return (
    <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
      <LabelRangeFilmstrip
        media={media}
        start={record.start}
        end={record.end}
      />
    </div>
  );
}

function LabelRangeFilmstrip({
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

/**
 * Link the label's track to a real-world Entity. The track is the per-media
 * cluster (one face track, one object track), so the link identifies every
 * detection in the track — here and via cross-media entity queries.
 */
function EntityLinkSection({ record }: { record: InspectorLabelRecord }) {
  const params = useParams();
  const workspaceId = params.workspaceId as string;
  const assign = useAssignTrackEntity();

  const trackId = (record as { LabelTrackRef?: string }).LabelTrackRef;
  const track = record.expand?.LabelTrackRef;
  if (!trackId || !workspaceId) return null;

  return (
    <div className="p-3 border rounded bg-muted/20 flex items-center justify-between gap-3 flex-wrap">
      <div>
        <h4 className="text-xs font-medium uppercase text-muted-foreground mb-1">
          Entity
        </h4>
        <p className="text-sm text-muted-foreground">
          Identify this track across media
        </p>
      </div>
      <EntityPicker
        workspaceId={workspaceId}
        value={track?.EntityRef}
        onChange={(entityId) => assign.mutate({ trackId, entityId })}
        disabled={assign.isPending}
      />
    </div>
  );
}

function StatTiles({
  config,
  record,
}: {
  config: InspectorTypeConfig;
  record: InspectorLabelRecord;
}) {
  const track = record.expand?.LabelTrackRef;
  const tiles: Array<{ label: string; value: string }> = [
    { label: 'Start Time', value: formatClipTime(record.start) },
    { label: 'End Time', value: formatClipTime(record.end) },
    { label: 'Duration', value: `${record.duration.toFixed(2)}s` },
    {
      label: 'Confidence',
      value: `${Math.round(confidenceOf(config, record) * 100)}%`,
    },
  ];
  if (track) {
    tiles.push(
      { label: 'Track ID', value: track.trackId },
      {
        label: 'Frames',
        value: String(
          Array.isArray(track.keyframes) ? track.keyframes.length : 0
        ),
      }
    );
  }
  tiles.push(...(config.detailExtras?.(record) ?? []));

  return (
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
  );
}
