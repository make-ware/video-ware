'use client';

import { useParams } from 'next/navigation';
import { LABEL_TYPE_META } from '@project/shared/mutator';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Loader2, Scissors } from 'lucide-react';
import { LabelPreview } from '@/components/labels/label-preview';
import { TrackCropThumb } from '@/components/labels/track-crop-thumb';
import { EntityPicker } from '@/components/labels/entity/entity-picker';
import { useAssignLabelEntity } from '@/hooks/use-entities';
import pb from '@/lib/pocketbase-client';
import { formatClipTime } from '@/utils/format-clip-time';
import type { LabelRecord } from '@/hooks/use-label-list';
import { confidenceOf, type InspectorTypeConfig } from './config';

interface LabelDetailPanelProps {
  config: InspectorTypeConfig;
  record: LabelRecord | null;
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
    <Card className="md:col-span-2 flex flex-col h-full min-h-0 overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 shrink-0">
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
      <CardContent className="flex-1 min-h-0 overflow-y-auto pt-6">
        {record ? (
          <div className="space-y-4">
            <LabelPreview
              media={record.expand?.MediaRef}
              track={
                config.preview === 'track'
                  ? record.expand?.LabelTrackRef
                  : undefined
              }
              start={record.start}
              end={record.end}
            />
            <EntityLinkSection config={config} record={record} />
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

/**
 * Link this label to a real-world Entity. The link lives on the row's
 * LabelEntity — the per-media, per-instance record — so it identifies every
 * detection of that instance, here and via cross-media entity queries.
 */
function EntityLinkSection({
  config,
  record,
}: {
  config: InspectorTypeConfig;
  record: LabelRecord;
}) {
  const params = useParams();
  const workspaceId = params.workspaceId as string;
  const assign = useAssignLabelEntity();

  const labelEntity = record.expand?.LabelEntityRef;
  const track = record.expand?.LabelTrackRef;
  const media = record.expand?.MediaRef;
  // Fall back to the track's LabelEntity for rows a partial label run left
  // with a blank ref: the track holds the identity, and without this the row
  // is silently unlinkable (the picker just doesn't render).
  const ownRef = (record as { LabelEntityRef?: string }).LabelEntityRef;
  const labelEntityId = ownRef || track?.LabelEntityRef;

  /**
   * Link, repairing the row's own ref first when we got here through the
   * track. Every attribution query filters on the row's LabelEntityRef, so
   * linking without the repair leaves this label absent from entity views
   * even though the link itself landed correctly.
   */
  const link = async (entityId: string | null) => {
    if (!labelEntityId) return;
    if (!ownRef) {
      try {
        // TypedPocketBase's collection() overloads reject a union of names —
        // same cast the list hook uses; every one of these collections has a
        // LabelEntityRef.
        await pb
          .collection(
            LABEL_TYPE_META[config.labelType].collection as 'LabelObjects'
          )
          .update(record.id, { LabelEntityRef: labelEntityId });
      } catch (err) {
        // Non-fatal: the link below still lands on the right LabelEntity.
        console.error('Failed to repair label → LabelEntity ref', err);
      }
    }
    assign.mutate({ labelEntityId, entityId });
  };

  if (!workspaceId) return null;
  if (!labelEntityId) {
    return (
      <div className="p-3 border rounded bg-muted/20">
        <h4 className="text-xs font-medium uppercase text-muted-foreground mb-1">
          Entity
        </h4>
        <p className="text-sm text-muted-foreground">
          This label has no detection record to link an entity to. Re-run labels
          for this media, or tag the whole media instead.
        </p>
      </div>
    );
  }

  // No inherited-from-cluster case any more: with one link point there is
  // nothing to inherit from, so an unlinked picker means unattributed.
  return (
    <div className="p-3 border rounded bg-muted/20 flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-3 min-w-0">
        {media && track && (
          <TrackCropThumb
            media={media}
            track={track}
            className="h-14 w-14 rounded-md"
          />
        )}
        <div className="min-w-0">
          <h4 className="text-xs font-medium uppercase text-muted-foreground mb-1">
            Entity
          </h4>
          <p className="text-sm text-muted-foreground">
            Identify this label across media
          </p>
        </div>
      </div>
      <EntityPicker
        workspaceId={workspaceId}
        value={labelEntity?.EntityRef ?? ''}
        onChange={(entityId) => void link(entityId)}
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
  record: LabelRecord;
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
