'use client';

import { useDeferredValue, useState } from 'react';
import { useParams } from 'next/navigation';
import { EntityKind } from '@project/shared';
import { useCreateEntity, useEntityKindCounts } from '@/hooks/use-entities';
import { ENTITY_KIND_ORDER } from '@/components/entities/entity-kind';
import { EntityKindSection } from '@/components/entities/entity-list';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Plus, Search } from 'lucide-react';

/**
 * Entities home: the real-world people, places, products, and things that
 * label tracks/clusters are linked to across media — one card-grid section
 * per kind, searchable across all of them.
 */
export default function EntitiesPage() {
  const params = useParams();
  const workspaceId = params.workspaceId as string;

  const { counts, isLoading: countsLoading } = useEntityKindCounts(workspaceId);
  const createEntity = useCreateEntity(workspaceId);

  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<EntityKind>(EntityKind.PERSON);
  const [description, setDescription] = useState('');

  // Only kinds that have entities get a section; the per-section empty
  // states then only ever mean "your search excluded this kind".
  const visibleKinds = ENTITY_KIND_ORDER.filter((k) => (counts?.[k] ?? 0) > 0);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    createEntity.mutate(
      {
        name: trimmed,
        kind,
        description: description.trim() || undefined,
      },
      {
        onSuccess: () => {
          setCreateOpen(false);
          setName('');
          setDescription('');
        },
      }
    );
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Entities</h1>
          <p className="text-muted-foreground">
            People, places, products, and things — link speaker and face tracks
            to them to identify who or what appears across your media.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-1.5" />
          New Entity
        </Button>
      </div>

      <div className="relative max-w-sm">
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
        <div className="space-y-8">
          {visibleKinds.map((k) => (
            <EntityKindSection
              key={k}
              workspaceId={workspaceId}
              kind={k}
              search={deferredSearch}
            />
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <form onSubmit={handleCreate}>
            <DialogHeader>
              <DialogTitle>New entity</DialogTitle>
              <DialogDescription>
                A stable identity you can link labels to across media.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label
                  htmlFor="entity-name"
                  className="text-sm font-medium leading-none"
                >
                  Name <span className="text-destructive">*</span>
                </label>
                <Input
                  id="entity-name"
                  placeholder="Erik"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={createEntity.isPending}
                  maxLength={200}
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium leading-none">Kind</label>
                <Select
                  value={kind}
                  onValueChange={(v) => setKind(v as EntityKind)}
                  disabled={createEntity.isPending}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.values(EntityKind).map((k) => (
                      <SelectItem key={k} value={k}>
                        <span className="capitalize">{k}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label
                  htmlFor="entity-description"
                  className="text-sm font-medium leading-none"
                >
                  Description (optional)
                </label>
                <Input
                  id="entity-description"
                  placeholder="Host of the weekly show"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={createEntity.isPending}
                  maxLength={500}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateOpen(false)}
                disabled={createEntity.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createEntity.isPending || !name.trim()}
              >
                {createEntity.isPending ? 'Creating…' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
