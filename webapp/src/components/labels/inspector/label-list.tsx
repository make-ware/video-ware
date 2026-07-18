'use client';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { formatClipTime } from '@/utils/format-clip-time';
import { TrackCropThumb } from '@/components/labels/track-crop-thumb';
import {
  EntityBadge,
  type EntityDisplay,
} from '@/components/labels/entity/entity-badge';
import { confidenceOf, type InspectorTypeConfig } from './config';
import { effectiveEntityId, type InspectorLabelRecord } from './use-label-list';

/** Multi-select wiring for track-based types; omitted = single-select list. */
export interface LabelListSelection {
  isSelected: (id: string) => boolean;
  /** Row click — caller resolves cmd/shift semantics via useMultiSelect. */
  onRowClick: (id: string, event: React.MouseEvent) => void;
  onToggle: (id: string) => void;
}

interface LabelListProps {
  config: InspectorTypeConfig;
  records: InspectorLabelRecord[];
  selectedId?: string;
  onSelect: (id: string) => void;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
  selection?: LabelListSelection;
  /** Entity id → display info for the per-row linked-entity badge. */
  entitiesById?: ReadonlyMap<string, EntityDisplay>;
  /** Render a bbox-cropped thumbnail per row (track-based types). */
  showThumbs?: boolean;
}

export function LabelList({
  config,
  records,
  selectedId,
  onSelect,
  hasActiveFilters,
  onClearFilters,
  selection,
  entitiesById,
  showThumbs,
}: LabelListProps) {
  if (records.length === 0) {
    return (
      <div className="p-4 text-center space-y-2">
        <p className="text-sm text-muted-foreground">
          {hasActiveFilters
            ? 'No labels match the current filters.'
            : `No ${config.title.toLowerCase()} found.`}
        </p>
        {hasActiveFilters && (
          <Button variant="outline" size="sm" onClick={onClearFilters}>
            Clear filters
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className={cn('p-4 pt-0 space-y-1.5', selection && 'select-none')}>
      {records.map((record) => {
        const media = record.expand?.MediaRef;
        const track = record.expand?.LabelTrackRef;
        const entityId = effectiveEntityId(record);
        const entity = entityId ? entitiesById?.get(entityId) : undefined;
        const title = config.listTitle(record);
        const checked = selection?.isSelected(record.id) ?? false;

        return (
          <div
            key={record.id}
            role="button"
            tabIndex={0}
            onClick={(event) => {
              if (selection) selection.onRowClick(record.id, event);
              else onSelect(record.id);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelect(record.id);
              }
            }}
            className={cn(
              'w-full flex items-center gap-2.5 rounded-md border border-transparent px-2 py-2 text-left cursor-pointer transition-colors hover:bg-accent/50',
              selectedId === record.id && 'bg-secondary',
              checked && 'border-primary/40 bg-primary/5'
            )}
          >
            {selection && (
              <Checkbox
                checked={checked}
                onCheckedChange={() => selection.onToggle(record.id)}
                onClick={(event) => event.stopPropagation()}
                aria-label={`Select ${title}`}
                className="shrink-0"
              />
            )}
            {showThumbs && media && track && (
              <TrackCropThumb
                media={media}
                track={track}
                className="h-12 w-12 rounded-md"
              />
            )}
            <div className="flex-1 min-w-0 space-y-0.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium capitalize truncate">
                  {title}
                </span>
                <Badge
                  variant="outline"
                  className="shrink-0 text-[10px] font-mono"
                >
                  {Math.round(confidenceOf(config, record) * 100)}%
                </Badge>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground font-mono truncate">
                  {formatClipTime(record.start)} –{' '}
                  {formatClipTime(record.end)} · {record.duration.toFixed(1)}s
                </span>
                {entity && (
                  <EntityBadge
                    name={entity.name}
                    colorIndex={entity.colorIndex}
                    className="max-w-[45%] shrink-0"
                  />
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
