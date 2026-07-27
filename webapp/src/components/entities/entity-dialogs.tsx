'use client';

import { useState } from 'react';
import { EntityKind, type Entity, type EntityPatch } from '@project/shared';
import { useCreateEntity, useUpdateEntity } from '@/hooks/use-entities';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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
import { Label } from '@/components/ui/label';

/**
 * `aliases` is a JSONField, so it reads back as `unknown` — every consumer has
 * to guard it. These two are the read/write pair for the comma-separated
 * field, mirroring the CLI's parseAliases (cli/src/commands/entity.ts).
 */
export function parseAliasInput(raw: string): string[] {
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (trimmed) seen.add(trimmed);
  }
  return [...seen];
}

export function formatAliasInput(aliases: unknown): string {
  if (!Array.isArray(aliases)) return '';
  return aliases.filter((a): a is string => typeof a === 'string').join(', ');
}

/** Shallow equality for the alias list, so an unchanged field is not patched. */
function sameAliases(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

interface EntityFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  /** Absent → create mode; present → edit mode. */
  entity?: Entity;
}

/**
 * The entity form, in both modes. Create needs a kind (it decides which
 * section the entity lands in); edit shows it read-only, since kind is part of
 * UNIQUE (WorkspaceRef, kind, name) and changing it re-buckets the record.
 *
 * `metadata` is deliberately not exposed — it is provider/importer JSON with
 * no meaningful text representation.
 */
export function EntityFormDialog({
  open,
  onOpenChange,
  workspaceId,
  entity,
}: EntityFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* DialogContent unmounts while closed, so the form's state
            initialisers re-run on every open — a cancelled edit never leaves
            its draft behind. The key covers switching entity while open. */}
        <EntityForm
          key={entity?.id ?? 'new'}
          workspaceId={workspaceId}
          entity={entity}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function EntityForm({
  workspaceId,
  entity,
  onDone,
}: {
  workspaceId: string;
  entity?: Entity;
  onDone: () => void;
}) {
  const isEdit = !!entity;
  const createEntity = useCreateEntity(workspaceId);
  const updateEntity = useUpdateEntity();
  const isPending = createEntity.isPending || updateEntity.isPending;

  const [name, setName] = useState(() => entity?.name ?? '');
  const [kind, setKind] = useState<EntityKind>(
    () => (entity?.kind as EntityKind) ?? EntityKind.PERSON
  );
  const [aliases, setAliases] = useState(() =>
    formatAliasInput(entity?.aliases)
  );
  const [description, setDescription] = useState(
    () => entity?.description ?? ''
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const trimmedDescription = description.trim();
    const parsedAliases = parseAliasInput(aliases);

    if (!entity) {
      createEntity.mutate(
        {
          name: trimmedName,
          kind,
          description: trimmedDescription || undefined,
        },
        { onSuccess: onDone }
      );
      return;
    }

    // Only changed fields: a no-op save would bump `updated` and invalidate
    // six query families for nothing.
    const patch: EntityPatch = {};
    if (trimmedName !== entity.name) patch.name = trimmedName;
    if (
      !sameAliases(
        parsedAliases,
        parseAliasInput(formatAliasInput(entity.aliases))
      )
    ) {
      patch.aliases = parsedAliases;
    }
    if (trimmedDescription !== (entity.description ?? '')) {
      patch.description = trimmedDescription;
    }
    if (Object.keys(patch).length === 0) {
      onDone();
      return;
    }
    updateEntity.mutate({ entityId: entity.id, patch }, { onSuccess: onDone });
  };

  return (
    <form onSubmit={handleSubmit}>
      <DialogHeader>
        <DialogTitle>{isEdit ? 'Edit entity' : 'New entity'}</DialogTitle>
        <DialogDescription>
          A stable identity you can link labels to across media.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4 py-4">
        <div className="space-y-2">
          <Label htmlFor="entity-name">
            Name <span className="text-destructive">*</span>
          </Label>
          <Input
            id="entity-name"
            placeholder="Erik"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isPending}
            maxLength={200}
            autoFocus
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={isEdit ? undefined : 'entity-kind'}>Kind</Label>
          {isEdit ? (
            <div>
              <Badge variant="outline" className="capitalize">
                {String(entity.kind)}
              </Badge>
            </div>
          ) : (
            <Select
              value={kind}
              onValueChange={(v) => setKind(v as EntityKind)}
              disabled={isPending}
            >
              <SelectTrigger id="entity-kind" className="w-full">
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
          )}
        </div>
        {isEdit && (
          <div className="space-y-2">
            <Label htmlFor="entity-aliases">Aliases (optional)</Label>
            <Input
              id="entity-aliases"
              placeholder="Eric, E."
              value={aliases}
              onChange={(e) => setAliases(e.target.value)}
              disabled={isPending}
            />
            <p className="text-xs text-muted-foreground">
              Comma-separated. Also matched by search.
            </p>
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="entity-description">Description (optional)</Label>
          <Input
            id="entity-description"
            placeholder="Host of the weekly show"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={isPending}
            maxLength={500}
          />
        </div>
      </div>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={onDone}
          disabled={isPending}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isPending || !name.trim()}>
          {isPending
            ? isEdit
              ? 'Saving…'
              : 'Creating…'
            : isEdit
              ? 'Save'
              : 'Create'}
        </Button>
      </DialogFooter>
    </form>
  );
}

interface EntityDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entity: Entity;
  /** Labels currently attributed to this entity, for the confirm copy. */
  labelTotal: number;
  mediaCount: number;
  isPending: boolean;
  onConfirm: () => void;
}

/**
 * Delete confirmation. Kept a sibling of EntityFormDialog rather than nested
 * inside it — an AlertDialog inside a Dialog fights Radix's focus traps.
 */
export function EntityDeleteDialog({
  open,
  onOpenChange,
  entity,
  labelTotal,
  mediaCount,
  isPending,
  onConfirm,
}: EntityDeleteDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete entity</AlertDialogTitle>
          <AlertDialogDescription>
            Delete &quot;{entity.name}&quot;? This unlinks it from {labelTotal}{' '}
            label{labelTotal === 1 ? '' : 's'} across {mediaCount} media and
            removes its media tags. The labels and media themselves are kept.
            This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={isPending}>
            {isPending ? 'Deleting…' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
