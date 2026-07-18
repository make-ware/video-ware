'use client';

import { useState } from 'react';
import type { EntityKind } from '@project/shared';
import { useEntitiesByKind, useEntityCardThumbs } from '@/hooks/use-entities';
import { PaginationControls } from '@/components/pagination/pagination-controls';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';
import { ENTITY_KIND_META } from './entity-kind';
import { EntityCard } from './entity-card';

const PER_PAGE = 12;

/**
 * One kind's section on the entities home page: header (icon, label, count),
 * a paginated card grid, and a "no matches" line while a search excludes the
 * whole kind. The page only mounts sections for kinds that have entities;
 * a stale page number after a search/delete self-heals inside the fetch
 * (useEntitiesByKind falls back to the real last page).
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
  const [page, setPage] = useState(1);

  const meta = ENTITY_KIND_META[kind];

  const {
    entities,
    page: currentPage,
    totalPages,
    totalItems,
    isLoading,
  } = useEntitiesByKind(workspaceId, kind, page, PER_PAGE, search);
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

      <PaginationControls
        page={currentPage}
        totalPages={totalPages}
        onPageChange={setPage}
      />
    </section>
  );
}
