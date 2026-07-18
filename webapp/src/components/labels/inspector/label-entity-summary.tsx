'use client';

import { cn } from '@/lib/utils';
import { entityDotClass } from '@/components/labels/entity/entity-badge';

export interface EntitySummaryGroup {
  /** '' = the unlinked group. */
  entityId: string;
  name: string;
  colorIndex: number;
  /** Record ids in this group, used for chip-click selection. */
  ids: string[];
  /** Whether every record of the group is currently multi-selected. */
  selected: boolean;
}

interface LabelEntitySummaryProps {
  groups: EntitySummaryGroup[];
  onGroupClick: (group: EntitySummaryGroup, event: React.MouseEvent) => void;
}

/**
 * One chip per entity present in the current list (plus Unlinked), showing
 * how many labels each has. Clicking a chip selects that whole group, so
 * re-labeling every occurrence of an entity is two clicks: chip → assign.
 * Cmd/Ctrl-click adds or removes a group from the selection.
 */
export function LabelEntitySummary({
  groups,
  onGroupClick,
}: LabelEntitySummaryProps) {
  if (groups.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {groups.map((group) => (
        <button
          key={group.entityId || '__unlinked__'}
          type="button"
          onClick={(event) => onGroupClick(group, event)}
          title={`Select ${group.ids.length} label${group.ids.length === 1 ? '' : 's'}`}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs transition-colors hover:bg-accent',
            group.selected && 'border-primary bg-primary/10'
          )}
        >
          {group.entityId ? (
            <span
              className={cn(
                'h-2 w-2 rounded-full shrink-0',
                entityDotClass(group.colorIndex)
              )}
            />
          ) : (
            <span className="h-2 w-2 rounded-full border border-dashed border-muted-foreground shrink-0" />
          )}
          <span className="max-w-32 truncate">{group.name}</span>
          <span className="text-muted-foreground font-mono">
            {group.ids.length}
          </span>
        </button>
      ))}
    </div>
  );
}
