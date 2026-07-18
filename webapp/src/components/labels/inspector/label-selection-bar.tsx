'use client';

import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { EntityPicker } from '@/components/labels/entity/entity-picker';

interface LabelSelectionBarProps {
  /** Currently multi-selected row count. */
  count: number;
  /** Total selectable rows in the list (after filters). */
  total: number;
  /**
   * Entity shared by every selected row: an id, '' when uniformly unlinked,
   * undefined when the selection is mixed (shows the assign placeholder).
   */
  sharedEntityId?: string;
  workspaceId: string;
  isAssigning: boolean;
  onAssign: (entityId: string | null) => void;
  onSelectAll: () => void;
  onClear: () => void;
}

/**
 * Selection toolbar pinned above the label list on track-based types:
 * All/X select-all and clear buttons with the live count, and the bulk
 * entity picker on its own row. One entity pick links every selected row's
 * track (picking "No entity" bulk-unlinks them). The picker stays visible —
 * disabled — while nothing is selected, so the select → assign flow is
 * discoverable before the first row is selected.
 */
export function LabelSelectionBar({
  count,
  total,
  sharedEntityId,
  workspaceId,
  isAssigning,
  onAssign,
  onSelectAll,
  onClear,
}: LabelSelectionBarProps) {
  return (
    <div className="border-b bg-muted/30 px-3 py-2 space-y-2">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2.5"
          onClick={onSelectAll}
          disabled={total === 0 || count === total}
        >
          All
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 w-7 px-0"
          onClick={onClear}
          disabled={count === 0}
          aria-label="Clear selection"
        >
          <X className="h-4 w-4" />
        </Button>
        <span className="ml-auto text-xs text-muted-foreground whitespace-nowrap">
          {count} of {total} selected
        </span>
      </div>
      <EntityPicker
        workspaceId={workspaceId}
        value={count > 0 ? sharedEntityId : undefined}
        placeholder={count > 0 ? 'Assign entity…' : 'Select labels to assign'}
        onChange={onAssign}
        disabled={isAssigning || count === 0}
        className="w-full"
      />
    </div>
  );
}
