'use client';

import { useState, useDeferredValue } from 'react';
import { useParams } from 'next/navigation';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2 } from 'lucide-react';
import type { InspectorTypeConfig } from './config';
import { LabelFilterBar } from './label-filter-bar';
import { LabelList } from './label-list';
import { LabelDetailPanel } from './label-detail-panel';
import { useLabelList, type LabelListFilters } from './use-label-list';
import { useCreateClipFromLabel } from './use-create-clip-from-label';

/**
 * Generic list + detail inspector for one label type, driven entirely by an
 * InspectorTypeConfig. Each /labels/<type> route renders this with its config.
 */
export function LabelInspectorPage({
  config,
}: {
  config: InspectorTypeConfig;
}) {
  const params = useParams();
  const mediaId = params.id as string;

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
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 h-[calc(100vh-12rem)]">
      <Card className="md:col-span-1 flex flex-col h-full">
        <CardHeader className="space-y-3">
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
        </CardHeader>
        <CardContent className="flex-1 overflow-hidden p-0">
          <ScrollArea className="h-full">
            <LabelList
              config={config}
              records={records}
              selectedId={selected?.id}
              onSelect={setSelectedId}
              hasActiveFilters={hasActiveFilters}
              onClearFilters={() =>
                setFilters({ minConfidence: 0, minDuration: 0, query: '' })
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
