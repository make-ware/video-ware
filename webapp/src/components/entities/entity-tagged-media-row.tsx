'use client';

import Link from 'next/link';
import { X, Film } from 'lucide-react';
import { mediaDisplayName } from '@/hooks/use-entities';
import { useEntityTaggedMedia, useUntagMedia } from '@/hooks/use-media-tags';

/**
 * The media manually tagged with this entity ("featured in"), as a compact
 * row of chips linking to each media's page. Renders nothing when the entity
 * has no tags — tagging happens from the media page (or `vw media tag`).
 */
export function EntityTaggedMediaRow({
  workspaceId,
  entityId,
}: {
  workspaceId: string;
  entityId: string;
}) {
  const { tags } = useEntityTaggedMedia(entityId);
  const untagMedia = useUntagMedia();

  if (tags.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-2">
      <span className="text-[10px] font-medium uppercase text-muted-foreground">
        Tagged media
      </span>
      {tags.map((tag) => (
        <span
          key={tag.id}
          className="inline-flex items-center gap-1 rounded border bg-muted/30 pl-1.5 pr-0.5 py-px text-[11px] font-medium min-w-0"
        >
          <Film className="h-3 w-3 shrink-0 text-muted-foreground" />
          <Link
            href={`/ws/${workspaceId}/media/${tag.MediaRef}`}
            className="truncate hover:underline"
          >
            {mediaDisplayName(tag.expand?.MediaRef) || tag.MediaRef}
          </Link>
          <button
            type="button"
            aria-label="Remove tag"
            className="rounded p-0.5 opacity-60 hover:opacity-100"
            onClick={() =>
              untagMedia.mutate({ mediaId: tag.MediaRef, entityId })
            }
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
    </div>
  );
}
