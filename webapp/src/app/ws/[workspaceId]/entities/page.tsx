'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { EntityKind } from '@project/shared';
import { useCreateEntity, useWorkspaceEntities } from '@/hooks/use-entities';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
import { Loader2, Plus, UserRound } from 'lucide-react';

/**
 * Workspace entities: the real-world people, products, places, and things
 * that label tracks/clusters are linked to across media.
 */
export default function EntitiesPage() {
  const params = useParams();
  const workspaceId = params.workspaceId as string;
  const { entities, isLoading } = useWorkspaceEntities(workspaceId);
  const createEntity = useCreateEntity(workspaceId);

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<EntityKind>(EntityKind.PERSON);
  const [description, setDescription] = useState('');

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
    <div className="container mx-auto p-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Entities</CardTitle>
            <CardDescription>
              People, products, places, and things — link speaker and face
              tracks to them to identify who or what appears across your media.
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            New Entity
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center p-8">
              <Loader2 className="animate-spin h-8 w-8 text-primary" />
            </div>
          ) : entities.length === 0 ? (
            <p className="text-muted-foreground text-center py-12">
              No entities yet. Create one, then link speakers from a
              media&apos;s Speakers → Identify tab, or faces from the label
              inspector.
            </p>
          ) : (
            <div className="divide-y">
              {entities.map((entity) => (
                <Link
                  key={entity.id}
                  href={`/ws/${workspaceId}/entities/${entity.id}`}
                  className="flex items-center justify-between gap-3 py-3 px-2 hover:bg-muted/50 rounded transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <UserRound className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <div className="font-medium truncate">{entity.name}</div>
                      {entity.description && (
                        <div className="text-sm text-muted-foreground truncate">
                          {entity.description}
                        </div>
                      )}
                    </div>
                  </div>
                  <Badge variant="outline" className="capitalize shrink-0">
                    {String(entity.kind)}
                  </Badge>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

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
