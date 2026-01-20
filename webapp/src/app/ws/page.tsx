'use client';

import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspace } from '@/hooks/use-workspace';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Building2, Users, ArrowRight, Plus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useState } from 'react';
import type { Workspace } from '@project/shared';

function CreateWorkspaceDialogContent({
  onCreate,
  onClose,
}: {
  onCreate: (name: string, slug?: string) => Promise<Workspace>;
  onClose: () => void;
}) {
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
          onClick={onClose}
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

export default function WorkspaceSelectionPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { workspaces, isLoading, createWorkspace } = useWorkspace();
  const router = useRouter();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  // Redirect to login if not authenticated
  if (!authLoading && !isAuthenticated) {
    router.push('/login?redirect=/ws');
    return null;
  }

  if (authLoading || isLoading) {
    return (
      <div className="container mx-auto py-8 space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-48 w-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Select Workspace
          </h1>
          <p className="text-muted-foreground mt-2">
            Choose a workspace to get started, or create a new one.
          </p>
        </div>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Create Workspace
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

      {workspaces.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Building2 className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No workspaces yet</h3>
            <p className="text-muted-foreground text-center mb-6">
              Create your first workspace to start organizing your projects and
              media.
            </p>
            <Dialog
              open={isCreateDialogOpen}
              onOpenChange={setIsCreateDialogOpen}
            >
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Workspace
                </Button>
              </DialogTrigger>
              <DialogContent>
                <CreateWorkspaceDialogContent
                  onCreate={createWorkspace}
                  onClose={() => setIsCreateDialogOpen(false)}
                />
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {workspaces.map((membership) => {
            const workspace = membership.expand?.WorkspaceRef;
            if (!workspace) return null;

            return (
              <Card
                key={workspace.id}
                className="flex flex-col hover:shadow-lg transition-shadow cursor-pointer"
                onClick={() => router.push(`/ws/${workspace.id}`)}
              >
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <CardTitle className="flex items-center gap-2">
                        <Building2 className="h-5 w-5 text-primary" />
                        {workspace.name}
                      </CardTitle>
                      <CardDescription>
                        {workspace.slug ? `@${workspace.slug}` : 'No slug'}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 mt-auto pt-6">
                  <Button
                    className="w-full gap-2"
                    onClick={(e) => {
                      e.stopPropagation();
                      router.push(`/ws/${workspace.id}`);
                    }}
                  >
                    <Users className="h-4 w-4" />
                    Open Workspace
                    <ArrowRight className="h-4 w-4 ml-auto" />
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
