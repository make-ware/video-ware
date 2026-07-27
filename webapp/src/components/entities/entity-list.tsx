'use client';

import type { EntityKind } from '@project/shared';
import { useEntityList } from '@/hooks/use-entity-list';
import { useEntityCardThumbs } from '@/hooks/use-entities';
import { LibraryLoadMore } from '@/components/library/library-load-more';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';
import { ENTITY_KIND_META } from './entity-kind';
import { EntityCard } from './entity-card';

/**
 * One kind's section on the entities home page: header (icon, label, count),
 * a card grid that grows via Load More, and a "no matches" line while a
 * search excludes the whole kind.
 *
 * The page only mounts sections for kinds that have entities. Each section is
 * an independent list, so paging one kind never refetches another.
 */
export function EntityKindSection({
  workspaceId,
  kind,
  search,
}: {
  workspaceId: string;
  kind: EntityKind;
  search: string;
}) {
  const meta = ENTITY_KIND_META[kind];

  const {
    items: entities,
    totalItems,
    isLoading,
    hasNextPage,
    isFetchingNextPage,
    loadMore,
    error,
  } = useEntityList({ workspaceId, kind, searchQuery: search });

  // Grows as pages load, so later pages get their thumbnails too. While the
  // widened set refetches, unknown ids read as undefined and those cards fall
  // back to the kind icon — never another entity's image.
  const { thumbsById } = useEntityCardThumbs(entities.map((e) => e.id));

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <meta.icon className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-lg font-medium">{meta.label}</h2>
        {totalItems > 0 && <Badge variant="secondary">{totalItems}</Badge>}
      </div>

      {isLoading ? (
        <div className="flex justify-center p-8">
          <Loader2 className="animate-spin h-6 w-6 text-primary" />
        </div>
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : entities.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {search.trim()
            ? `No ${meta.label.toLowerCase()} match "${search.trim()}".`
            : `No ${meta.label.toLowerCase()} yet.`}
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {entities.map((entity) => (
            <EntityCard
              key={entity.id}
              workspaceId={workspaceId}
              entity={entity}
              thumbTrack={thumbsById?.[entity.id]}
            />
          ))}
        </div>
      )}

      <LibraryLoadMore
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        loadedCount={entities.length}
        totalItems={totalItems}
        onLoadMore={loadMore}
      />
    </section>
  );
}
