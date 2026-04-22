'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useWorkspace } from '@/hooks/use-workspace';
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarLabel,
  MenubarMenu,
  MenubarSeparator,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
  MenubarRadioGroup,
  MenubarRadioItem,
} from '@/components/ui/menubar';
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
import {
  Plus,
  Upload,
  FileCode,
  Activity,
  BarChart,
  Building2,
  Settings,
  Sun,
  Moon,
  Monitor,
  HelpCircle,
  Info,
  Check,
  Film,
  Clapperboard,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface AppMenubarProps {
  className?: string;
}

export function AppMenubar({ className }: AppMenubarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const {
    currentWorkspace,
    workspaces,
    switchWorkspace,
    createWorkspace,
    isLoading: workspaceLoading,
  } = useWorkspace();
  const { theme, setTheme } = useTheme();

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [newWorkspaceSlug, setNewWorkspaceSlug] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const workspaceId = currentWorkspace?.id;
  const wsPrefix = workspaceId ? `/ws/${workspaceId}` : '';

  const isTimelineEditor =
    /\/ws\/[^/]+\/timelines\/[^/]+/.test(pathname) &&
    !pathname.endsWith('/timelines');

  const hasWorkspace = !!workspaceId;

  const shortcuts = hasWorkspace
    ? [
      {
        href: `${wsPrefix}/uploads`,
        label: 'Upload',
        icon: Upload,
        match: `${wsPrefix}/uploads`,
      },
      {
        href: `${wsPrefix}/media`,
        label: 'Media',
        icon: Film,
        match: `${wsPrefix}/media`,
      },
      {
        href: `${wsPrefix}/timelines`,
        label: 'Timelines',
        icon: Clapperboard,
        match: `${wsPrefix}/timelines`,
      },
    ]
    : [];

  const handleSwitchWorkspace = async (id: string) => {
    try {
      await switchWorkspace(id);
      router.push(`/ws/${id}/media`);
    } catch (error) {
      console.error('Failed to switch workspace:', error);
    }
  };

  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWorkspaceName.trim()) {
      setCreateError('Workspace name is required');
      return;
    }

    setIsCreating(true);
    setCreateError(null);

    try {
      const workspace = await createWorkspace(
        newWorkspaceName.trim(),
        newWorkspaceSlug.trim() || undefined
      );
      setNewWorkspaceName('');
      setNewWorkspaceSlug('');
      setCreateDialogOpen(false);
      router.push(`/ws/${workspace.id}/media`);
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
    <>
      <Menubar
        className={cn(
          'border-0 rounded-none shadow-none bg-transparent h-auto p-0',
          className
        )}
      >
        {/* Workspace Menu */}
        <MenubarMenu>
          <MenubarTrigger className="text-xs font-medium px-2 py-1">
            <Building2 className="mr-1.5 h-3.5 w-3.5" />
            {currentWorkspace ? currentWorkspace.name : 'Workspace'}
          </MenubarTrigger>
          <MenubarContent className="min-w-[200px]">
            {workspaceLoading ? (
              <MenubarItem disabled>Loading...</MenubarItem>
            ) : workspaces.length > 0 ? (
              <>
                <MenubarLabel>Switch Workspace</MenubarLabel>
                {workspaces.map((membership) => {
                  const workspace = membership.expand?.WorkspaceRef;
                  if (!workspace) return null;
                  const isActive = workspace.id === workspaceId;
                  return (
                    <MenubarItem
                      key={workspace.id}
                      onClick={() => handleSwitchWorkspace(workspace.id)}
                    >
                      {isActive && <Check className="mr-2 h-4 w-4" />}
                      <span className={isActive ? '' : 'pl-6'}>
                        @{workspace.name}
                      </span>
                    </MenubarItem>
                  );
                })}
              </>
            ) : (
              <MenubarItem disabled>No workspaces</MenubarItem>
            )}
            <MenubarSeparator />
            <MenubarItem onClick={() => setCreateDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              New Workspace
            </MenubarItem>
            <MenubarItem onClick={() => router.push('/workspaces')}>
              <Settings className="mr-2 h-4 w-4" />
              Manage Workspaces
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        {/* Workspace shortcuts */}
        {shortcuts.length > 0 && (
          <>
            <span aria-hidden className="mx-1 h-4 w-px bg-border self-center" />
            {shortcuts.map((shortcut) => {
              const isActive = pathname.startsWith(shortcut.match);
              const Icon = shortcut.icon;
              return (
                <Link
                  key={shortcut.href}
                  href={shortcut.href}
                  className={cn(
                    'flex items-center gap-1.5 rounded-sm px-2 py-1 text-xs font-medium transition-colors outline-none select-none',
                    'hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground',
                    isActive
                      ? 'bg-accent text-accent-foreground'
                      : 'text-foreground/80'
                  )}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {shortcut.label}
                </Link>
              );
            })}
            <span aria-hidden className="mx-1 h-4 w-px bg-border self-center" />
          </>
        )}

        {/* Help Menu */}
        <MenubarMenu>
          <MenubarTrigger className="text-xs font-medium px-2 py-1">
            Help
          </MenubarTrigger>
          <MenubarContent>
            <MenubarItem disabled>
              <HelpCircle className="mr-2 h-4 w-4" />
              Documentation
            </MenubarItem>
            <MenubarItem disabled>
              <Info className="mr-2 h-4 w-4" />
              About VideoWare
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        {/* Settings Menu */}
        <MenubarMenu>
          <MenubarTrigger
            className="text-xs font-medium px-2 py-1"
            disabled={!hasWorkspace}
          >
            Settings
          </MenubarTrigger>
          <MenubarContent>
            <MenubarItem onClick={() => router.push(`${wsPrefix}/tasks`)}>
              <Activity className="mr-2 h-4 w-4" />
              Tasks
            </MenubarItem>
            <MenubarItem onClick={() => router.push(`${wsPrefix}/metrics`)}>
              <BarChart className="mr-2 h-4 w-4" />
              Metrics
            </MenubarItem>
            <MenubarSeparator />
            <MenubarSub>
              <MenubarSubTrigger>
                <Sun className="mr-2 h-4 w-4 dark:hidden" />
                <Moon className="mr-2 h-4 w-4 hidden dark:block" />
                Theme
              </MenubarSubTrigger>
              <MenubarSubContent>
                <MenubarRadioGroup value={theme} onValueChange={setTheme}>
                  <MenubarRadioItem value="light">
                    <Sun className="mr-2 h-4 w-4" />
                    Light
                  </MenubarRadioItem>
                  <MenubarRadioItem value="dark">
                    <Moon className="mr-2 h-4 w-4" />
                    Dark
                  </MenubarRadioItem>
                  <MenubarRadioItem value="system">
                    <Monitor className="mr-2 h-4 w-4" />
                    System
                  </MenubarRadioItem>
                </MenubarRadioGroup>
              </MenubarSubContent>
            </MenubarSub>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>

      {/* Create Workspace Dialog */}
      <Dialog
        open={createDialogOpen}
        onOpenChange={(open) => {
          setCreateDialogOpen(open);
          if (!open) {
            setNewWorkspaceName('');
            setNewWorkspaceSlug('');
            setCreateError(null);
          }
        }}
      >
        <DialogContent>
          <form onSubmit={handleCreateWorkspace}>
            <DialogHeader>
              <DialogTitle>Create New Workspace</DialogTitle>
              <DialogDescription>
                Create a new workspace to organize your projects and media.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label
                  htmlFor="menubar-workspace-name"
                  className="text-sm font-medium leading-none"
                >
                  Name <span className="text-destructive">*</span>
                </label>
                <Input
                  id="menubar-workspace-name"
                  placeholder="My Workspace"
                  value={newWorkspaceName}
                  onChange={(e) => {
                    setNewWorkspaceName(e.target.value);
                    setCreateError(null);
                  }}
                  disabled={isCreating}
                  maxLength={100}
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <label
                  htmlFor="menubar-workspace-slug"
                  className="text-sm font-medium leading-none"
                >
                  Slug (optional)
                </label>
                <Input
                  id="menubar-workspace-slug"
                  placeholder="my-workspace"
                  value={newWorkspaceSlug}
                  onChange={(e) => {
                    setNewWorkspaceSlug(e.target.value);
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
                onClick={() => setCreateDialogOpen(false)}
                disabled={isCreating}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isCreating || !newWorkspaceName.trim()}
              >
                {isCreating ? 'Creating...' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
