'use client';

import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { EntityPicker } from '@/components/labels/entity/entity-picker';

interface LabelSelectionBarProps {
  count: number;
  /**
   * Entity shared by every selected row: an id, '' when uniformly unlinked,
   * undefined when the selection is mixed (shows the assign placeholder).
   */
  sharedEntityId?: string;
  workspaceId: string;
  isAssigning: boolean;
  onAssign: (entityId: string | null) => void;
  onClear: () => void;
}

/**
 * Bulk action bar shown while the label list has a multi-selection: one
 * entity pick links every selected row's track (picking "No entity"
 * bulk-unlinks them).
 */
export function LabelSelectionBar({
  count,
  sharedEntityId,
  workspaceId,
  isAssigning,
  onAssign,
  onClear,
}: LabelSelectionBarProps) {
  return (
    <div className="border-t bg-muted/30 px-3 py-2 flex items-center gap-2">
      <span className="text-xs font-medium whitespace-nowrap">
        {count} selected
      </span>
      <EntityPicker
        workspaceId={workspaceId}
        value={sharedEntityId}
        placeholder="Assign entity…"
        onChange={onAssign}
        disabled={isAssigning}
        className="flex-1 min-w-0"
      />
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        onClick={onClear}
        aria-label="Clear selection"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
