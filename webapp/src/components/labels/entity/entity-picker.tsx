'use client';

import { useState } from 'react';
import { EntityKind } from '@project/shared';
import { useCreateEntity, useWorkspaceEntities } from '@/hooks/use-entities';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Plus, UserRound } from 'lucide-react';

const NONE = '__none__';
const CREATE = '__create__';

interface EntityPickerProps {
  workspaceId: string;
  /** Currently linked entity id ('' or undefined when unlinked). */
  value?: string;
  onChange: (entityId: string | null) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Dropdown that links a label cluster to a real-world Entity: pick an
 * existing one, clear the link, or create a new entity inline. Pure control
 * — the caller owns the write (usually useAssignTrackEntity).
 */
export function EntityPicker({
  workspaceId,
  value,
  onChange,
  disabled,
  className,
}: EntityPickerProps) {
  const { entities, isLoading } = useWorkspaceEntities(workspaceId);
  const createEntity = useCreateEntity(workspaceId);

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState<EntityKind>(EntityKind.PERSON);

  const handleSelect = (selected: string) => {
    if (selected === CREATE) {
      setCreateOpen(true);
      return;
    }
    onChange(selected === NONE ? null : selected);
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    createEntity.mutate(
      { name, kind: newKind },
      {
        onSuccess: (entity) => {
          setCreateOpen(false);
          setNewName('');
          onChange(entity.id);
        },
      }
    );
  };

  return (
    <>
      <Select
        value={value || NONE}
        onValueChange={handleSelect}
        disabled={disabled || isLoading}
      >
        <SelectTrigger size="sm" className={className}>
          <UserRound className="h-3.5 w-3.5 text-muted-foreground" />
          <SelectValue placeholder="Link entity…" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>
            <span className="text-muted-foreground">No entity</span>
          </SelectItem>
          {entities.map((entity) => (
            <SelectItem key={entity.id} value={entity.id}>
              {entity.name}
              <span className="ml-1 text-xs text-muted-foreground">
                {String(entity.kind)}
              </span>
            </SelectItem>
          ))}
          <SelectSeparator />
          <SelectItem value={CREATE}>
            <Plus className="h-3.5 w-3.5" />
            New entity…
          </SelectItem>
        </SelectContent>
      </Select>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <form onSubmit={handleCreate}>
            <DialogHeader>
              <DialogTitle>New entity</DialogTitle>
              <DialogDescription>
                A person, product, place, or thing you can link labels to across
                media.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label
                  htmlFor="entity-picker-name"
                  className="text-sm font-medium leading-none"
                >
                  Name <span className="text-destructive">*</span>
                </label>
                <Input
                  id="entity-picker-name"
                  placeholder="Erik"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  disabled={createEntity.isPending}
                  maxLength={200}
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium leading-none">Kind</label>
                <Select
                  value={newKind}
                  onValueChange={(v) => setNewKind(v as EntityKind)}
                  disabled={createEntity.isPending}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.values(EntityKind).map((kind) => (
                      <SelectItem key={kind} value={kind}>
                        <span className="capitalize">{kind}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                disabled={createEntity.isPending || !newName.trim()}
              >
                {createEntity.isPending ? 'Creating…' : 'Create & link'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
