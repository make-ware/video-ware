'use client';

import { useState } from 'react';
import { useWorkspace } from '@/hooks/use-workspace';
import type { Workspace } from '@project/shared';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Building2, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface WorkspaceSelectorProps {
  className?: string;
}

interface CreateWorkspaceDialogContentProps {
  onCreate: (name: string, slug?: string) => Promise<Workspace>;
  onClose: () => void;
}

function CreateWorkspaceDialogContent({
  onCreate,
  onClose,
}: CreateWorkspaceDialogContentProps) {
  const [workspaceName, setWorkspaceName] = useState('');
  const [workspaceSlug, setWorkspaceSlug] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceName.trim()) {
      setCreateError('Workspace name is required');
      return;
    }

    setIsCreating(true);
    setCreateError(null);

    try {
      await onCreate(workspaceName.trim(), workspaceSlug.trim() || undefined);
      // Reset form and close dialog
      setWorkspaceName('');
      setWorkspaceSlug('');
      onClose();
    } catch (error) {
      console.error('Failed to create workspace:', error);
      setCreateError(
        error instanceof Error ? error.message : 'Failed to create workspace'
      );
    } finally {
      setIsCreating(false);
    }
  };

  const handleClose = () => {
    setWorkspaceName('');
    setWorkspaceSlug('');
    setCreateError(null);
    onClose();
  };

  return (
    <form onSubmit={handleSubmit}>
      <DialogHeader>
        <DialogTitle>Create New Workspace</DialogTitle>
        <DialogDescription>
          Create a new workspace to organize your projects and media.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4 py-4">
        <div className="space-y-2">
          <label
            htmlFor="workspace-name"
            className="text-sm font-medium leading-none"
          >
            Name <span className="text-destructive">*</span>
          </label>
          <Input
            id="workspace-name"
            placeholder="My Workspace"
            value={workspaceName}
            onChange={(e) => {
              setWorkspaceName(e.target.value);
              setCreateError(null);
            }}
            disabled={isCreating}
            aria-invalid={!!createError}
            maxLength={100}
            autoFocus
          />
        </div>
        <div className="space-y-2">
          <label
            htmlFor="workspace-slug"
            className="text-sm font-medium leading-none"
          >
            Slug (optional)
          </label>
          <Input
            id="workspace-slug"
            placeholder="my-workspace"
            value={workspaceSlug}
            onChange={(e) => {
              setWorkspaceSlug(e.target.value);
              setCreateError(null);
            }}
            disabled={isCreating}
            maxLength={100}
          />
          <p className="text-xs text-muted-foreground">
            A URL-friendly identifier for your workspace
          </p>
        </div>
        {createError && (
          <p className="text-sm text-destructive">{createError}</p>
        )}
      </div>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={handleClose}
          disabled={isCreating}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isCreating || !workspaceName.trim()}>
          {isCreating ? 'Creating...' : 'Create'}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function WorkspaceSelector({ className }: WorkspaceSelectorProps) {
  const {
    currentWorkspace,
    workspaces,
    isLoading,
    switchWorkspace,
    createWorkspace,
    hasWorkspaces,
  } = useWorkspace();

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  const handleWorkspaceChange = async (workspaceId: string) => {
    try {
      await switchWorkspace(workspaceId);
    } catch (error) {
      console.error('Failed to switch workspace:', error);
    }
  };

  if (isLoading) {
    return <Skeleton className={cn('h-8 w-32', className)} />;
  }

  if (!hasWorkspaces) {
    return (
      <div className={cn('flex items-center gap-2', className)}>
        <div
          className={cn(
            'flex items-center gap-1.5 text-xs text-gray-500',
            className
          )}
        >
          <Building2 className="h-3.5 w-3.5" />
          <span>No workspaces</span>
        </div>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button
              variant="outline"
              size="icon-sm"
              className="h-8 w-8"
              type="button"
            >
              <Plus className="h-3.5 w-3.5" />
              <span className="sr-only">Create workspace</span>
            </Button>
          </DialogTrigger>
          <DialogContent>
            <CreateWorkspaceDialogContent
              onCreate={createWorkspace}
              onClose={() => setIsCreateDialogOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Select
        value={currentWorkspace?.id || ''}
        onValueChange={handleWorkspaceChange}
      >
        <SelectTrigger className="h-8 w-32 text-xs">
          <Building2 className="h-3.5 w-3.5 mr-1.5" />
          <SelectValue placeholder="Select workspace" />
        </SelectTrigger>
        <SelectContent>
          {workspaces.map((membership) => {
            const workspace = membership.expand?.WorkspaceRef;
            if (!workspace) return null;

            return (
              <SelectItem key={workspace.id} value={workspace.id}>
                @{workspace.name}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogTrigger asChild>
          <Button
            variant="outline"
            size="icon-sm"
            className="h-8 w-8"
            type="button"
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="sr-only">Create workspace</span>
          </Button>
        </DialogTrigger>
        <DialogContent>
          <CreateWorkspaceDialogContent
            onCreate={createWorkspace}
            onClose={() => setIsCreateDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
