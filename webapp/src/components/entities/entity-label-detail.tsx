'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAssignLabelEntity } from '@/hooks/use-entities';
import {
  useEntityLabels,
  type EntityLabelMediaGroup,
  type EntityLabelRow,
} from '@/hooks/use-entity-labels';
import { LabelPreview } from '@/components/labels/label-preview';
import { TrackCropThumb } from '@/components/labels/track-crop-thumb';
import { PaginationControls } from '@/components/pagination/pagination-controls';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { formatClipTime } from '@/utils/format-clip-time';
import { ArrowLeft, ExternalLink, Loader2, Unlink } from 'lucide-react';
import {
  entityLabelConfidence,
  type EntityLabelTypeConfig,
} from './entity-label-config';

const PER_PAGE = 25;

/**
 * Detail pane for one media: an animated preview of the selected label above
 * a scrollable, paginated list of every label of the active type attributed
 * to the entity in that media (per-row unlink clears the row's LabelEntity
 * link). Mounted per selected media, so page/selection reset when it changes.
 *
 * `onBack` returns a phone to the media list, where this pane replaced it
 * rather than sitting beside it.
 */
export function EntityMediaLabelsPane({
  workspaceId,
  entityId,
  entityName,
  config,
  mediaGroup,
  onBack,
}: {
  workspaceId: string;
  entityId: string;
  entityName: string;
  config: EntityLabelTypeConfig;
  mediaGroup: EntityLabelMediaGroup | null;
  onBack?: () => void;
}) {
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string>();

  const {
    labels,
    page: currentPage,
    totalPages,
    totalItems,
    isLoading,
  } = useEntityLabels(
    entityId,
    config.labelType,
    mediaGroup?.mediaId ?? null,
    page,
    PER_PAGE
  );

  const selected =
    labels.find((row) => row.id === selectedId) ?? labels[0] ?? null;
  const selectedTrack = selected?.expand?.LabelTrackRef;
  // Speaker/speech tracks have no bounding boxes — range filmstrip instead.
  const selectedPreviewTrack =
    selectedTrack &&
    Array.isArray(selectedTrack.keyframes) &&
    selectedTrack.keyframes.length > 0
      ? selectedTrack
      : undefined;

  if (!mediaGroup) {
    return (
      <Card className="min-h-0 md:col-span-2">
        <CardContent className="flex items-center justify-center h-full text-muted-foreground">
          Select a media to view its labels.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="min-h-0 flex flex-col md:col-span-2 py-3 gap-2">
      <CardHeader className="shrink-0 px-3 sm:px-4">
        {onBack && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="-ml-2 h-8 justify-self-start px-2 text-muted-foreground md:hidden"
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Media
          </Button>
        )}
        <CardTitle className="text-sm truncate">{mediaGroup.name}</CardTitle>
        <CardDescription>
          {totalItems || mediaGroup.count} linked{' '}
          {(totalItems || mediaGroup.count) === 1 ? 'label' : 'labels'} for{' '}
          {entityName}
        </CardDescription>
        <CardAction>
          <Button asChild variant="outline" size="sm">
            <Link
              href={`/ws/${workspaceId}/media/${mediaGroup.mediaId}/labels/${config.mediaLabelsRoute}`}
            >
              <ExternalLink className="h-4 w-4 sm:mr-1.5" />
              <span className="hidden sm:inline">Open media</span>
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 flex flex-col px-3 gap-3 sm:px-4">
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="animate-spin h-6 w-6 text-primary" />
          </div>
        ) : (
          <>
            {selected && (
              <LabelPreview
                media={selected.expand?.MediaRef}
                track={selectedPreviewTrack}
                start={selected.start}
                end={selected.end}
                className="shrink-0 h-24 sm:h-32 md:h-48 mx-auto"
              />
            )}
            <div className="flex-1 min-h-0 overflow-y-auto space-y-1">
              {labels.map((row) => (
                <MediaLabelRow
                  key={row.id}
                  row={row}
                  config={config}
                  entityId={entityId}
                  entityName={entityName}
                  isSelected={selected?.id === row.id}
                  onSelect={() => setSelectedId(row.id)}
                />
              ))}
            </div>
            <PaginationControls
              page={currentPage}
              totalPages={totalPages}
              onPageChange={setPage}
              className="shrink-0"
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function MediaLabelRow({
  row,
  config,
  entityId,
  entityName,
  isSelected,
  onSelect,
}: {
  row: EntityLabelRow;
  config: EntityLabelTypeConfig;
  entityId: string;
  entityName: string;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const unlink = useAssignLabelEntity();
  const media = row.expand?.MediaRef;
  const track = row.expand?.LabelTrackRef;
  const labelEntity = row.expand?.LabelEntityRef;
  // One link point now, so every attributed row is directly linked — there is
  // no inherited-from-cluster case left to distinguish.
  const direct = labelEntity?.EntityRef === entityId;
  const hasThumb =
    media &&
    track &&
    Array.isArray(track.keyframes) &&
    track.keyframes.length > 0;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        'w-full flex items-center gap-2.5 rounded-md border border-transparent px-2 py-2 text-left cursor-pointer transition-colors hover:bg-accent/50 sm:py-1.5',
        isSelected && 'bg-secondary'
      )}
    >
      {hasThumb && (
        <TrackCropThumb
          media={media}
          track={track}
          className="h-10 w-10 rounded-md shrink-0"
        />
      )}
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm truncate">
            {config.rowTitle(row, entityName)}
          </span>
          <Badge variant="outline" className="shrink-0 text-[10px] font-mono">
            {Math.round(entityLabelConfidence(config.labelType, row) * 100)}%
          </Badge>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono">
            {formatClipTime(row.start)} – {formatClipTime(row.end)}
          </span>
        </div>
      </div>
      {direct && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          disabled={unlink.isPending}
          onClick={(event) => {
            event.stopPropagation();
            if (labelEntity) {
              unlink.mutate({ labelEntityId: labelEntity.id, entityId: null });
            }
          }}
          title="Remove the entity link from this label (unlinks every detection of this instance)"
        >
          <Unlink className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}
