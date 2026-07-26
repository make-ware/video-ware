'use client';

import { UserRound } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useWorkspaceEntities } from '@/hooks/use-entities';

/** Sentinel for "no entity filter" — the Select can't hold a null value. */
export const MEDIA_ENTITY_FILTER_ALL = '__all__';

/**
 * Returns a predicate over media ids for the entity filter: the client mirror
 * of `listMedia`'s entity clause. `linkedIds` is the (best-effort, capped) set
 * of media linked to the entity; while it is still loading — `undefined` — the
 * clause passes so a realtime update can never evict a row the server did
 * return. A spurious insert is corrected by the next refetch.
 */
export function mediaEntityFilterPredicate(
  entityId: string | null,
  linkedIds: Set<string> | undefined
): (mediaId: string) => boolean {
  if (!entityId || !linkedIds) return () => true;
  return (mediaId) => linkedIds.has(mediaId);
}

interface MediaEntityFilterProps {
  workspaceId: string;
  /** null = all entities. */
  value: string | null;
  onChange: (entityId: string | null) => void;
  className?: string;
}

/**
 * Filters the media list to one entity — media tagged with it or with a label
 * track attributed to it. Deliberately not the EntityPicker: that one carries
 * "No entity" / create-inline semantics that make no sense in a filter.
 */
export function MediaEntityFilter({
  workspaceId,
  value,
  onChange,
  className,
}: MediaEntityFilterProps) {
  const { entities } = useWorkspaceEntities(workspaceId);

  return (
    <Select
      value={value ?? MEDIA_ENTITY_FILTER_ALL}
      onValueChange={(next) =>
        onChange(next === MEDIA_ENTITY_FILTER_ALL ? null : next)
      }
    >
      <SelectTrigger className={className ?? 'w-[170px] h-7 text-xs'}>
        <span className="flex items-center gap-2 truncate">
          <UserRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <SelectValue placeholder="All Entities" />
        </span>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={MEDIA_ENTITY_FILTER_ALL}>All Entities</SelectItem>
        {entities.map((entity) => (
          <SelectItem key={entity.id} value={entity.id}>
            <span className="flex items-center gap-2">
              <span className="truncate">{entity.name}</span>
              <span className="text-xs text-muted-foreground capitalize">
                {String(entity.kind)}
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
