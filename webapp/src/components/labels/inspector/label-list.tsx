'use client';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatClipTime } from '@/utils/format-clip-time';
import { confidenceOf, type InspectorTypeConfig } from './config';
import type { InspectorLabelRecord } from './use-label-list';

interface LabelListProps {
  config: InspectorTypeConfig;
  records: InspectorLabelRecord[];
  selectedId?: string;
  onSelect: (id: string) => void;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
}

export function LabelList({
  config,
  records,
  selectedId,
  onSelect,
  hasActiveFilters,
  onClearFilters,
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
    <div className="p-4 pt-0 space-y-2">
      {records.map((record) => (
        <Button
          key={record.id}
          variant={selectedId === record.id ? 'secondary' : 'ghost'}
          className="w-full justify-start text-left h-auto py-3 flex flex-col items-start gap-1"
          onClick={() => onSelect(record.id)}
        >
          <div className="w-full flex items-center justify-between gap-2">
            <span className="font-medium capitalize truncate">
              {config.listTitle(record)}
            </span>
            <Badge variant="outline" className="shrink-0 text-[10px] font-mono">
              {Math.round(confidenceOf(config, record) * 100)}%
            </Badge>
          </div>
          <div className="text-xs text-muted-foreground font-mono">
            {formatClipTime(record.start)} – {formatClipTime(record.end)} ·{' '}
            {record.duration.toFixed(1)}s
          </div>
        </Button>
      ))}
    </div>
  );
}
