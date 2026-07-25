'use client';

import Link from 'next/link';
import { X } from 'lucide-react';
import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { useWorkspaceEntities } from '@/hooks/use-entities';
import {
  useMediaTags,
  useTagMedia,
  useUntagMedia,
} from '@/hooks/use-media-tags';
import { EntityPicker } from '@/components/labels/entity/entity-picker';
import {
  entityBadgeClass,
  entityDotClass,
} from '@/components/labels/entity/entity-badge';

interface MediaTagsRowProps {
  workspaceId: string;
  mediaId: string;
  className?: string;
}

/**
 * The media's whole-media entity tags ("this media features X") as a row of
 * removable chips plus an add picker. Chips link to the entity's page; colors
 * follow the workspace entity list order like the label inspectors.
 */
export function MediaTagsRow({
  workspaceId,
  mediaId,
  className,
}: MediaTagsRowProps) {
  const { tags } = useMediaTags(mediaId);
  const { entities } = useWorkspaceEntities(workspaceId);
  const tagMedia = useTagMedia();
  const untagMedia = useUntagMedia();

  const colorIndexById = useMemo(() => {
    const map = new Map<string, number>();
    entities.forEach((entity, index) => map.set(entity.id, index));
    return map;
  }, [entities]);

  const taggedIds = useMemo(
    () => new Set(tags.map((tag) => tag.EntityRef)),
    [tags]
  );

  const handleAdd = (entityId: string | null) => {
    if (!entityId || taggedIds.has(entityId)) return;
    tagMedia.mutate({ workspaceId, mediaId, entityId });
  };

  return (
    // Picker stays anchored top-left; chips fill the space to its right and
    // wrap onto further lines as they accumulate.
    <div className={cn('flex items-start gap-1.5', className)}>
      <EntityPicker
        workspaceId={workspaceId}
        value={undefined}
        onChange={handleAdd}
        disabled={tagMedia.isPending}
        placeholder="Tag entity…"
        className="h-6 text-xs shrink-0"
      />
      <div className="flex min-h-6 flex-1 min-w-0 flex-wrap items-center gap-1.5">
        {tags.map((tag) => {
          const name = tag.expand?.EntityRef?.name ?? tag.EntityRef;
          const colorIndex = colorIndexById.get(tag.EntityRef) ?? 0;
          return (
            <span
              key={tag.id}
              className={cn(
                'inline-flex items-center gap-1 rounded border pl-1.5 pr-0.5 py-px text-[11px] font-medium min-w-0',
                entityBadgeClass(colorIndex)
              )}
            >
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full shrink-0',
                  entityDotClass(colorIndex)
                )}
              />
              <Link
                href={`/ws/${workspaceId}/entities/${tag.EntityRef}`}
                className="truncate hover:underline"
              >
                {name}
              </Link>
              <button
                type="button"
                aria-label={`Remove tag ${name}`}
                className="rounded p-0.5 opacity-60 hover:opacity-100"
                onClick={() =>
                  untagMedia.mutate({ mediaId, entityId: tag.EntityRef })
                }
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          );
        })}
      </div>
    </div>
  );
}
