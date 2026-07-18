'use client';

import { useCallback, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import type { LabelType } from '@project/shared';
import {
  useEntityLabelMedia,
  type EntityLabelMediaGroup,
} from '@/hooks/use-entity-labels';
import { PaginationControls } from '@/components/pagination/pagination-controls';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { Film, Loader2 } from 'lucide-react';
import {
  ENTITY_LABEL_CONFIGS,
  type EntityLabelTypeConfig,
} from './entity-label-config';
import { EntityMediaLabelsPane } from './entity-label-detail';

const MEDIA_PER_PAGE = 50;

/**
 * The entity detail page's linked-labels browser: one tab per label type
 * with attributed rows; within a type, the left panel lists the media the
 * labels appear in and the right pane previews every label in the selected
 * media. Fills the height it is given — each panel scrolls internally.
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
    <div className="flex flex-col h-full min-h-0 gap-3">
      <div className="shrink-0 overflow-x-auto">
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
      </div>
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
 * One label type's master–detail: the media the labels appear in on the
 * left, all of the selected media's labels on the right. Mounted per active
 * type tab, so selection state resets naturally when the type changes.
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
  const [mediaPage, setMediaPage] = useState(1);
  const [selectedMediaId, setSelectedMediaId] = useState<string>();

  const { mediaGroups, isLoading } = useEntityLabelMedia(
    entityId,
    config.labelType
  );

  const selected =
    mediaGroups.find((group) => group.mediaId === selectedMediaId) ??
    mediaGroups[0] ??
    null;

  const totalMediaPages = Math.ceil(mediaGroups.length / MEDIA_PER_PAGE);
  const currentMediaPage = Math.min(mediaPage, Math.max(1, totalMediaPages));
  const pagedGroups = mediaGroups.slice(
    (currentMediaPage - 1) * MEDIA_PER_PAGE,
    currentMediaPage * MEDIA_PER_PAGE
  );

  if (isLoading) {
    return (
      <div className="flex justify-center p-8">
        <Loader2 className="animate-spin h-6 w-6 text-primary" />
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 grid gap-3 grid-cols-1 grid-rows-[2fr_3fr] md:grid-rows-1 md:grid-cols-3">
      <Card className="min-h-0 flex flex-col md:col-span-1 py-3 gap-2">
        <CardHeader className="shrink-0 px-4">
          <CardTitle className="text-sm">
            Media · {mediaGroups.length}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 min-h-0 flex flex-col px-2 gap-2">
          <div className="flex-1 min-h-0 overflow-y-auto space-y-1">
            {pagedGroups.map((group) => (
              <MediaGroupRow
                key={group.mediaId}
                group={group}
                isSelected={selected?.mediaId === group.mediaId}
                onSelect={() => setSelectedMediaId(group.mediaId)}
              />
            ))}
          </div>
          <PaginationControls
            page={currentMediaPage}
            totalPages={totalMediaPages}
            onPageChange={setMediaPage}
            className="shrink-0"
          />
        </CardContent>
      </Card>

      <EntityMediaLabelsPane
        key={selected?.mediaId ?? 'none'}
        workspaceId={workspaceId}
        entityId={entityId}
        entityName={entityName}
        config={config}
        mediaGroup={selected}
      />
    </div>
  );
}

function MediaGroupRow({
  group,
  isSelected,
  onSelect,
}: {
  group: EntityLabelMediaGroup;
  isSelected: boolean;
  onSelect: () => void;
}) {
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
      <Film className="h-4 w-4 text-muted-foreground shrink-0" />
      <span className="flex-1 text-sm font-medium truncate">{group.name}</span>
      <Badge variant="outline" className="shrink-0 text-[10px] font-mono">
        {group.count}
      </Badge>
    </div>
  );
}
