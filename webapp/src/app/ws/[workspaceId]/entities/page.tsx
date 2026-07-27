'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useEntityKindCounts } from '@/hooks/use-entities';
import { ENTITY_KIND_ORDER } from '@/components/entities/entity-kind';
import { EntityKindSection } from '@/components/entities/entity-list';
import { EntityFormDialog } from '@/components/entities/entity-dialogs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Plus, Search, UsersRound } from 'lucide-react';

/**
 * Entities home: the real-world people, places, products, and things that
 * label tracks/clusters are linked to across media — one card-grid section
 * per kind, searchable across all of them.
 *
 * The search box holds its raw value; each section debounces it (300ms) inside
 * useEntityList, so a five-letter search costs one round of requests rather
 * than one per keystroke per section.
 */
export default function EntitiesPage() {
  const params = useParams();
  const workspaceId = params.workspaceId as string;

  const { counts, isLoading: countsLoading } = useEntityKindCounts(workspaceId);

  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  // Only kinds that have entities get a section; the per-section empty
  // states then only ever mean "your search excluded this kind". This also
  // keeps a sparse workspace to one section's queries instead of four.
  const visibleKinds = ENTITY_KIND_ORDER.filter((k) => (counts?.[k] ?? 0) > 0);

  return (
    <div className="container mx-auto max-w-7xl px-3 pt-4 pb-8 space-y-4 sm:px-6 sm:pt-6 sm:space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-semibold sm:gap-3 sm:text-3xl">
            <UsersRound className="h-6 w-6 shrink-0 sm:h-7 sm:w-7" />
            Entities
          </h1>
          <p className="mt-1 text-sm text-muted-foreground sm:text-base">
            People, places, products, and things — link speaker and face tracks
            to them to identify who or what appears across your media.
          </p>
        </div>
        <Button
          className="w-full sm:w-auto sm:shrink-0"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="h-4 w-4 mr-1.5" />
          New Entity
        </Button>
      </div>

      <div className="relative w-full sm:max-w-sm">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search entities…"
          className="pl-8"
        />
      </div>

      {countsLoading ? (
        <div className="flex justify-center p-8">
          <Loader2 className="animate-spin h-8 w-8 text-primary" />
        </div>
      ) : visibleKinds.length === 0 ? (
        <p className="text-muted-foreground text-center py-12">
          No entities yet. Create one, then link speakers from a media&apos;s
          Speakers → Identify tab, or faces from the label inspector.
        </p>
      ) : (
        <div className="space-y-6 sm:space-y-8">
          {visibleKinds.map((k) => (
            <EntityKindSection
              key={k}
              workspaceId={workspaceId}
              kind={k}
              search={search}
            />
          ))}
        </div>
      )}

      <EntityFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        workspaceId={workspaceId}
      />
    </div>
  );
}
