'use client';

import { useCallback, useState } from 'react';
import { useParams, usePathname, useSearchParams } from 'next/navigation';
import { EntityKind } from '@project/shared';
import { useCreateEntity, useEntityKindCounts } from '@/hooks/use-entities';
import {
  ENTITY_KIND_META,
  ENTITY_KIND_ORDER,
  parseEntityKind,
} from '@/components/entities/entity-kind';
import { EntityList } from '@/components/entities/entity-list';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus } from 'lucide-react';

/**
 * Workspace entities: the real-world people, places, products, and things
 * that label tracks/clusters are linked to across media — one paginated,
 * searchable list per kind.
 */
export default function EntitiesPage() {
  const params = useParams();
  const workspaceId = params.workspaceId as string;
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // The URL is the single source of truth for the active tab: replaceState
  // below feeds back into useSearchParams (no Next.js soft navigation), so
  // no state mirror is needed.
  const activeKind = parseEntityKind(searchParams.get('kind'));
  const { counts } = useEntityKindCounts(workspaceId);
  const createEntity = useCreateEntity(workspaceId);

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<EntityKind>(EntityKind.PERSON);
  const [description, setDescription] = useState('');

  const handleKindChange = useCallback(
    (value: string) => {
      const nextKind = parseEntityKind(value);
      const query = new URLSearchParams(window.location.search);
      if (nextKind === EntityKind.PERSON) query.delete('kind');
      else query.set('kind', nextKind);
      const qs = query.toString();
      window.history.replaceState(
        null,
        '',
        qs ? `${pathname}?${qs}` : pathname
      );
    },
    [pathname]
  );

  const openCreate = () => {
    setKind(activeKind);
    setCreateOpen(true);
  };

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
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1.5" />
          New Entity
        </Button>
      </div>

      <Tabs value={activeKind} onValueChange={handleKindChange}>
        <TabsList>
          {ENTITY_KIND_ORDER.map((k) => {
            const meta = ENTITY_KIND_META[k];
            return (
              <TabsTrigger key={k} value={k}>
                <meta.icon className="h-4 w-4 mr-1.5" />
                {meta.label}
                {counts && counts[k] > 0 && (
                  <Badge variant="secondary" className="ml-1.5">
                    {counts[k]}
                  </Badge>
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>
        {ENTITY_KIND_ORDER.map((k) => (
          <TabsContent key={k} value={k} className="mt-4">
            <EntityList workspaceId={workspaceId} kind={k} />
          </TabsContent>
        ))}
      </Tabs>

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
