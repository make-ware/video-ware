'use client';

import { useCallback, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import type { LabelType } from '@project/shared';
import { mediaDisplayName } from '@/hooks/use-entities';
import {
  useEntityLabels,
  type EntityLabelRow,
} from '@/hooks/use-entity-labels';
import { PaginationControls } from '@/components/pagination/pagination-controls';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TrackCropThumb } from '@/components/labels/track-crop-thumb';
import { cn } from '@/lib/utils';
import { formatClipTime } from '@/utils/format-clip-time';
import { Loader2 } from 'lucide-react';
import {
  ENTITY_LABEL_CONFIGS,
  entityLabelConfidence,
  type EntityLabelTypeConfig,
} from './entity-label-config';
import { EntityLabelDetail } from './entity-label-detail';

const PER_PAGE = 25;

/**
 * The entity detail page's linked-labels browser: one tab per label type
 * with attributed rows, each tab a paginated master–detail (selectable rows
 * on the left, label detail with preview on the right).
 */
export function EntityLabelsBrowser({
  workspaceId,
  entityId,
  entityName,
  counts,
  countsLoading,
}: {
  workspaceId: string;
  entityId: string;
  entityName: string;
  counts: Record<LabelType, number> | undefined;
  countsLoading: boolean;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // The URL is the single source of truth for the active tab: replaceState
  // below feeds back into useSearchParams (no Next.js soft navigation).
  const requestedType = searchParams.get('type');

  const handleTypeChange = useCallback(
    (value: string) => {
      const query = new URLSearchParams(window.location.search);
      query.set('type', value);
      window.history.replaceState(null, '', `${pathname}?${query.toString()}`);
    },
    [pathname]
  );

  if (countsLoading || !counts) {
    return (
      <div className="flex justify-center p-8">
        <Loader2 className="animate-spin h-6 w-6 text-primary" />
      </div>
    );
  }

  const visible = ENTITY_LABEL_CONFIGS.filter(
    (config) => (counts[config.labelType] ?? 0) > 0
  );

  if (visible.length === 0) {
    return (
      <Card>
        <CardContent>
          <p className="text-muted-foreground text-center py-8">
            Nothing linked yet. Open a media&apos;s labels and link a face track
            or speaker to this entity.
          </p>
        </CardContent>
      </Card>
    );
  }

  // A stale ?type= (or one whose labels were all unlinked) falls back to
  // the first non-empty tab.
  const activeConfig =
    visible.find((config) => config.labelType === requestedType) ?? visible[0];

  return (
    <div className="space-y-4">
      <Tabs value={activeConfig.labelType} onValueChange={handleTypeChange}>
        <TabsList>
          {visible.map((config) => (
            <TabsTrigger key={config.labelType} value={config.labelType}>
              {config.title}
              <Badge variant="secondary" className="ml-1.5">
                {counts[config.labelType]}
              </Badge>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <EntityLabelTypePanel
        key={activeConfig.labelType}
        workspaceId={workspaceId}
        entityId={entityId}
        entityName={entityName}
        config={activeConfig}
      />
    </div>
  );
}

/**
 * One label type's master–detail: paginated selectable rows on the left,
 * the selected label's detail on the right. Mounted per active type tab, so
 * page/selection state resets naturally when the type changes.
 */
function EntityLabelTypePanel({
  workspaceId,
  entityId,
  entityName,
  config,
}: {
  workspaceId: string;
  entityId: string;
  entityName: string;
  config: EntityLabelTypeConfig;
}) {
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string>();

  const {
    labels,
    page: currentPage,
    totalPages,
    totalItems,
    isLoading,
  } = useEntityLabels(entityId, config.labelType, page, PER_PAGE);

  const selected =
    labels.find((row) => row.id === selectedId) ?? labels[0] ?? null;

  if (isLoading) {
    return (
      <div className="flex justify-center p-8">
        <Loader2 className="animate-spin h-6 w-6 text-primary" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <Card className="md:col-span-1 flex flex-col">
        <CardHeader>
          <CardTitle>{config.title}</CardTitle>
          <CardDescription>
            {totalItems} linked {totalItems === 1 ? 'label' : 'labels'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex-1 overflow-hidden p-0 space-y-3">
          <ScrollArea className="max-h-[32rem]">
            <div className="p-4 pt-0 space-y-1.5">
              {labels.map((row) => (
                <EntityLabelListRow
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
          </ScrollArea>
          <PaginationControls
            page={currentPage}
            totalPages={totalPages}
            onPageChange={setPage}
            className="pb-4"
          />
        </CardContent>
      </Card>

      <EntityLabelDetail
        workspaceId={workspaceId}
        entityId={entityId}
        entityName={entityName}
        config={config}
        row={selected}
      />
    </div>
  );
}

function EntityLabelListRow({
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
  const media = row.expand?.MediaRef;
  const track = row.expand?.LabelTrackRef;
  const viaCluster = !track || track.EntityRef !== entityId;
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
        'w-full flex items-center gap-2.5 rounded-md border border-transparent px-2 py-2 text-left cursor-pointer transition-colors hover:bg-accent/50',
        isSelected && 'bg-secondary'
      )}
    >
      {hasThumb && (
        <TrackCropThumb
          media={media}
          track={track}
          className="h-12 w-12 rounded-md"
        />
      )}
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium truncate">
            {config.rowTitle(row, entityName)}
          </span>
          <Badge variant="outline" className="shrink-0 text-[10px] font-mono">
            {Math.round(entityLabelConfidence(config.labelType, row) * 100)}%
          </Badge>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground truncate">
            {mediaDisplayName(media) || row.MediaRef}
          </span>
          <span className="text-xs text-muted-foreground font-mono shrink-0">
            {formatClipTime(row.start)} – {formatClipTime(row.end)}
          </span>
        </div>
        {viaCluster && (
          <div className="text-[10px] text-muted-foreground">via cluster</div>
        )}
      </div>
    </div>
  );
}
