'use client';

import Link from 'next/link';
import type { MediaEntityLink } from '@project/shared';
import { cn } from '@/lib/utils';
import {
  entityBadgeClass,
  entityDotClass,
} from '@/components/labels/entity/entity-badge';

interface MediaEntityChipsProps {
  workspaceId: string;
  links: MediaEntityLink[];
  /** Entity id → palette index, so a card's colors match the label UIs. */
  colorIndexById?: Map<string, number>;
  /** Chips shown before collapsing the rest into a "+N" chip. */
  max?: number;
  className?: string;
}

/**
 * Read-only row of the entities attached to a media — curator tags and
 * label-derived appearances alike, in the view's order (curated first, then by
 * link count). Curation lives on the media detail page and in the media list's
 * selection toolbar, so these chips only navigate.
 */
export function MediaEntityChips({
  workspaceId,
  links,
  colorIndexById,
  max = 4,
  className,
}: MediaEntityChipsProps) {
  if (links.length === 0) return null;

  const shown = links.slice(0, max);
  const overflow = links.slice(max);

  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      {shown.map((link) => {
        const colorIndex = colorIndexById?.get(link.id) ?? 0;
        return (
          <Link
            key={link.id}
            href={`/ws/${workspaceId}/entities/${link.id}`}
            // The card itself navigates (and cmd/shift-click selects), so a
            // chip must not bubble its click up to the card.
            onClick={(e) => e.stopPropagation()}
            title={`${link.name} (${link.kind})`}
            className={cn(
              'inline-flex max-w-full items-center gap-1 rounded border pl-1.5 pr-1.5 py-px text-[11px] font-medium hover:underline',
              entityBadgeClass(colorIndex)
            )}
          >
            <span
              className={cn(
                'h-1.5 w-1.5 shrink-0 rounded-full',
                entityDotClass(colorIndex)
              )}
            />
            <span className="truncate">{link.name}</span>
          </Link>
        );
      })}
      {overflow.length > 0 && (
        <span
          className="text-[11px] text-muted-foreground"
          title={overflow.map((link) => link.name).join(', ')}
        >
          +{overflow.length}
        </span>
      )}
    </div>
  );
}
