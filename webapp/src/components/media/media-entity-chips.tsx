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
  /** Chips shown at `sm` and up before collapsing the rest into "+N". */
  max?: number;
  /** Chips shown below `sm`, where a card is roughly half as wide. */
  mobileMax?: number;
  className?: string;
}

/**
 * Read-only row of the entities attached to a media — curator tags and
 * label-derived appearances alike, in the view's order (curated first, then by
 * link count). Curation lives on the media detail page and in the media list's
 * selection toolbar, so these chips only navigate.
 *
 * The row is deliberately **one fixed-height line**: a media can carry dozens
 * of entities, and a wrapping row would let one card stretch every card in its
 * grid row. Chips shrink and truncate; the rest collapse into a "+N". The
 * visible count is breakpoint-dependent (`mobileMax` below `sm`), so both "+N"
 * counters are rendered and CSS picks the honest one for the current width.
 */
export function MediaEntityChips({
  workspaceId,
  links,
  colorIndexById,
  max = 3,
  mobileMax = 2,
  className,
}: MediaEntityChipsProps) {
  if (links.length === 0) return null;

  const wideMax = Math.max(max, mobileMax);
  const narrowMax = Math.min(mobileMax, wideMax);
  const shown = links.slice(0, wideMax);
  const wideOverflow = links.slice(wideMax);
  const narrowOverflow = links.slice(narrowMax);

  return (
    <div
      className={cn('flex h-5 items-center gap-1 overflow-hidden', className)}
    >
      {shown.map((link, index) => {
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
              'inline-flex min-w-0 items-center gap-1 rounded border px-1.5 py-px text-[11px] font-medium hover:underline',
              // Chips past the narrow budget only exist on wider cards.
              index >= narrowMax && 'hidden sm:inline-flex',
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
      {narrowOverflow.length > 0 && (
        <span
          className="shrink-0 text-[11px] text-muted-foreground sm:hidden"
          title={narrowOverflow.map((link) => link.name).join(', ')}
        >
          +{narrowOverflow.length}
        </span>
      )}
      {wideOverflow.length > 0 && (
        <span
          className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline"
          title={wideOverflow.map((link) => link.name).join(', ')}
        >
          +{wideOverflow.length}
        </span>
      )}
    </div>
  );
}
