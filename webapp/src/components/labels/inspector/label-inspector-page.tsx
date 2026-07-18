'use client';

import { useMemo, useState, useDeferredValue } from 'react';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { ListChecks, Loader2, X } from 'lucide-react';
import { useMultiSelect } from '@/hooks/use-multi-select';
import { useRegisterPageMenu } from '@/hooks/use-page-menu';
import type { PageMenuItem } from '@/contexts/page-menu-context';
import {
  useAssignTracksEntity,
  useWorkspaceEntities,
} from '@/hooks/use-entities';
import type { EntityDisplay } from '@/components/labels/entity/entity-badge';
import type { InspectorTypeConfig } from './config';
import { LabelFilterBar } from './label-filter-bar';
import { LabelList } from './label-list';
import { LabelDetailPanel } from './label-detail-panel';
import {
  LabelEntitySummary,
  type EntitySummaryGroup,
} from './label-entity-summary';
import { LabelSelectionBar } from './label-selection-bar';
import {
  effectiveEntityId,
  useLabelList,
  type LabelListFilters,
} from './use-label-list';
import { useCreateClipFromLabel } from './use-create-clip-from-label';

/**
 * Generic list + detail inspector for one label type, driven entirely by an
 * InspectorTypeConfig. Each /labels/<type> route renders this with its config.
 *
 * Track-based types (objects, faces, people) additionally get bbox-cropped
 * row thumbnails, multi-select, per-entity summary chips, and bulk entity
 * assignment — one entity in a video is usually labeled many times, so the
 * grouping + bulk flow keeps the click count low.
 */
export function LabelInspectorPage({
  config,
}: {
  config: InspectorTypeConfig;
}) {
  const params = useParams();
  const mediaId = params.id as string;
  const workspaceId = params.workspaceId as string;

  // Track-based types have a LabelTrack (bbox keyframes) per row — exactly
  // the types where the same entity recurs and bulk linking pays off.
  const supportsBulkEntity = config.preview === 'track';

  const [filters, setFilters] = useState<LabelListFilters>({
    minConfidence: config.defaultFilters.minConfidence,
    minDuration: config.defaultFilters.minDuration,
    query: '',
  });
  const deferredQuery = useDeferredValue(filters.query);
  const { data: records = [], isLoading } = useLabelList(config, mediaId, {
    ...filters,
    query: deferredQuery,
  });

  const [selectedId, setSelectedId] = useState<string>();
  const selected =
    records.find((r) => r.id === selectedId) ?? records[0] ?? null;

  const createClip = useCreateClipFromLabel();

  const { entities } = useWorkspaceEntities(workspaceId);
  const entitiesById = useMemo(() => {
    const map = new Map<string, EntityDisplay>();
    entities.forEach((entity, index) =>
      map.set(entity.id, { name: entity.name, colorIndex: index })
    );
    return map;
  }, [entities]);

  const recordIds = useMemo(() => records.map((r) => r.id), [records]);
  const multi = useMultiSelect({
    items: recordIds,
    enableKeyboard: supportsBulkEntity,
  });
  const { selectedIds, selectAll, clearSelection, selectionCount } = multi;

  // Selection actions in the nav bar's Edit menu, mirroring the media page.
  const editMenuItems = useMemo<PageMenuItem[]>(() => {
    if (!supportsBulkEntity) return [];
    return [
      {
        id: 'select-all',
        label: 'Select All',
        icon: ListChecks,
        disabled: recordIds.length === 0,
        onSelect: selectAll,
      },
      {
        id: 'clear-selection',
        label: 'Clear Selection',
        icon: X,
        disabled: selectionCount === 0,
        onSelect: clearSelection,
      },
    ];
  }, [
    supportsBulkEntity,
    recordIds.length,
    selectionCount,
    selectAll,
    clearSelection,
  ]);
  useRegisterPageMenu('edit', editMenuItems);

  const entityGroups = useMemo<EntitySummaryGroup[]>(() => {
    if (!supportsBulkEntity) return [];
    const byEntity = new Map<string, string[]>();
    for (const record of records) {
      const entityId = effectiveEntityId(record);
      const ids = byEntity.get(entityId) ?? [];
      ids.push(record.id);
      byEntity.set(entityId, ids);
    }
    const groups: EntitySummaryGroup[] = [];
    for (const [entityId, ids] of byEntity) {
      const display = entityId ? entitiesById.get(entityId) : undefined;
      groups.push({
        entityId,
        name: entityId ? (display?.name ?? 'Unknown entity') : 'Unlinked',
        colorIndex: display?.colorIndex ?? 0,
        ids,
        selected: ids.every((id) => selectedIds.has(id)),
      });
    }
    // Entities by label count; the unlinked bucket always last.
    return groups.sort((a, b) => {
      if (!a.entityId !== !b.entityId) return a.entityId ? -1 : 1;
      return b.ids.length - a.ids.length;
    });
  }, [supportsBulkEntity, records, entitiesById, selectedIds]);

  const handleGroupClick = (
    group: EntitySummaryGroup,
    event: React.MouseEvent
  ) => {
    const additive = event.metaKey || event.ctrlKey;
    multi.setSelectedIds((prev) => {
      if (additive) {
        const next = new Set(prev);
        if (group.selected) group.ids.forEach((id) => next.delete(id));
        else group.ids.forEach((id) => next.add(id));
        return next;
      }
      return group.selected ? new Set() : new Set(group.ids);
    });
  };

  const assignTracks = useAssignTracksEntity();
  const selectedRecords = useMemo(
    () => records.filter((r) => selectedIds.has(r.id)),
    [records, selectedIds]
  );
  const selectedTrackIds = useMemo(() => {
    const ids = new Set<string>();
    for (const record of selectedRecords) {
      const trackId = (record as { LabelTrackRef?: string }).LabelTrackRef;
      if (trackId) ids.add(trackId);
    }
    return [...ids];
  }, [selectedRecords]);
  const sharedEntityId = useMemo(() => {
    const ids = new Set(selectedRecords.map(effectiveEntityId));
    return ids.size === 1 ? [...ids][0] : undefined;
  }, [selectedRecords]);

  const handleBulkAssign = (entityId: string | null) => {
    if (selectedTrackIds.length === 0) {
      toast.error('None of the selected labels have a track to link');
      return;
    }
    assignTracks.mutate(
      { trackIds: selectedTrackIds, entityId },
      { onSuccess: () => multi.clearSelection() }
    );
  };

  const hasActiveFilters =
    filters.minConfidence > 0 ||
    filters.minDuration > 0 ||
    filters.query.trim() !== '';

  if (isLoading) {
    return (
      <div className="flex justify-center p-8">
        <Loader2 className="animate-spin h-8 w-8 text-primary" />
      </div>
    );
  }

  return (
    // minmax(0,1fr) row: the cards get exactly the viewport-fitted height
    // from the labels layout, so overflow scrolls inside the cards instead
    // of growing the page.
    <div className="grid grid-cols-1 md:grid-cols-3 md:grid-rows-[minmax(0,1fr)] gap-6 h-full min-h-0">
      <Card className="md:col-span-1 flex flex-col h-full min-h-0 overflow-hidden">
        <CardHeader className="space-y-3 shrink-0">
          <div>
            <CardTitle>{config.title}</CardTitle>
            <CardDescription>{config.subtitle}</CardDescription>
          </div>
          <LabelFilterBar
            filters={filters}
            onChange={setFilters}
            showQuery={config.queryFields.length > 0}
            searchPlaceholder={`Search ${config.title.toLowerCase()}…`}
          />
          {entityGroups.length > 0 && (
            <>
              <Separator />
              <LabelEntitySummary
                groups={entityGroups}
                onGroupClick={handleGroupClick}
              />
            </>
          )}
        </CardHeader>
        <CardContent className="flex-1 overflow-hidden p-0 flex flex-col">
          {supportsBulkEntity && records.length > 0 && (
            <LabelSelectionBar
              count={selectionCount}
              total={records.length}
              sharedEntityId={sharedEntityId}
              workspaceId={workspaceId}
              isAssigning={assignTracks.isPending}
              onAssign={handleBulkAssign}
              onSelectAll={selectAll}
              onClear={clearSelection}
            />
          )}
          <ScrollArea className="flex-1 min-h-0">
            <LabelList
              config={config}
              records={records}
              selectedId={selected?.id}
              onSelect={setSelectedId}
              hasActiveFilters={hasActiveFilters}
              onClearFilters={() =>
                setFilters({ minConfidence: 0, minDuration: 0, query: '' })
              }
              entitiesById={entitiesById}
              showThumbs={supportsBulkEntity}
              selection={
                supportsBulkEntity
                  ? {
                      isSelected: multi.isSelected,
                      onToggle: multi.toggleItem,
                      onRowClick: (id, event) => {
                        // Plain click selects just that row; cmd/shift
                        // toggle and range-extend via useMultiSelect. The
                        // clicked row always becomes the detail record.
                        if (multi.handleClick(id, event) === 'single') {
                          multi.setSelectedIds(new Set([id]));
                        }
                        setSelectedId(id);
                      },
                    }
                  : undefined
              }
            />
          </ScrollArea>
        </CardContent>
      </Card>

      <LabelDetailPanel
        config={config}
        record={selected}
        isCreating={createClip.isPending}
        onCreateClip={() => {
          if (selected) {
            createClip.mutate({
              kind: 'single',
              labelType: config.labelType,
              record: selected,
            });
          }
        }}
      />
    </div>
  );
}
