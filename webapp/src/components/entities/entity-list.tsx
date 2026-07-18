'use client';

import { useDeferredValue, useState } from 'react';
import Link from 'next/link';
import type { EntityKind } from '@project/shared';
import { useEntitiesByKind } from '@/hooks/use-entities';
import { PaginationControls } from '@/components/pagination/pagination-controls';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Loader2, Search } from 'lucide-react';
import { ENTITY_KIND_META } from './entity-kind';

const PER_PAGE = 25;

/**
 * One kind's paginated, searchable entity list. Mounted per active tab, so
 * page/search state resets naturally when the kind changes.
 */
export function EntityList({
  workspaceId,
  kind,
}: {
  workspaceId: string;
  kind: EntityKind;
}) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);

  const meta = ENTITY_KIND_META[kind];

  const {
    entities,
    page: currentPage,
    totalPages,
    totalItems,
    isLoading,
  } = useEntitiesByKind(workspaceId, kind, page, PER_PAGE, deferredSearch);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder={`Search ${meta.label.toLowerCase()}…`}
            className="pl-8"
          />
        </div>
        {totalItems > 0 && (
          <span className="text-sm text-muted-foreground shrink-0">
            {totalItems} {totalItems === 1 ? 'entity' : 'entities'}
          </span>
        )}
      </div>

      <Card>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center p-8">
              <Loader2 className="animate-spin h-8 w-8 text-primary" />
            </div>
          ) : entities.length === 0 ? (
            deferredSearch.trim() ? (
              <div className="text-center py-12 space-y-3">
                <p className="text-muted-foreground">
                  No {meta.label.toLowerCase()} match &quot;
                  {deferredSearch.trim()}&quot;.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleSearchChange('')}
                >
                  Clear search
                </Button>
              </div>
            ) : (
              <p className="text-muted-foreground text-center py-12">
                No {meta.label.toLowerCase()} yet. Create one, then link
                speakers from a media&apos;s Speakers → Identify tab, or faces
                from the label inspector.
              </p>
            )
          ) : (
            <div className="divide-y">
              {entities.map((entity) => {
                const aliases = Array.isArray(entity.aliases)
                  ? (entity.aliases as string[])
                  : [];
                return (
                  <Link
                    key={entity.id}
                    href={`/ws/${workspaceId}/entities/${entity.id}`}
                    className="flex items-center justify-between gap-3 py-3 px-2 hover:bg-muted/50 rounded transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <meta.icon className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-medium truncate">
                            {entity.name}
                          </span>
                          {aliases.map((alias) => (
                            <Badge
                              key={alias}
                              variant="secondary"
                              className="shrink-0"
                            >
                              {alias}
                            </Badge>
                          ))}
                        </div>
                        {entity.description && (
                          <div className="text-sm text-muted-foreground truncate">
                            {entity.description}
                          </div>
                        )}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <PaginationControls
        page={currentPage}
        totalPages={totalPages}
        onPageChange={setPage}
      />
    </div>
  );
}
