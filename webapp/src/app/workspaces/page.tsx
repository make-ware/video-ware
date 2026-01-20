'use client';

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
import { Building2, ArrowRight, ExternalLink, Settings } from 'lucide-react';
import Link from 'next/link';

export default function WorkspacesPage() {
  const { workspaces, isLoading } = useWorkspace();

  if (isLoading) {
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
          <h1 className="text-3xl font-bold tracking-tight">Workspaces</h1>
          <p className="text-muted-foreground mt-2">
            Manage your workspaces and team members.
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {workspaces.map((membership) => {
          const workspace = membership.expand?.WorkspaceRef;
          if (!workspace) return null;

          return (
            <div key={workspace.id} className="relative group">
              <Link href={`/ws/${workspace.id}/media`} className="block">
                <Card className="flex flex-col hover:shadow-lg transition-all hover:scale-[1.02] cursor-pointer h-full">
                  <CardHeader className="flex-1">
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
                  <CardContent className="pt-6">
                    <Button
                      size="lg"
                      className="w-full gap-2 pointer-events-none"
                    >
                      <ExternalLink className="h-4 w-4" />
                      View Workspace
                      <ArrowRight className="h-4 w-4 ml-auto" />
                    </Button>
                  </CardContent>
                </Card>
              </Link>
              <Link
                href={`/workspaces/${workspace.id}`}
                onClick={(e) => e.stopPropagation()}
                className="absolute top-3 right-3 z-10"
              >
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 hover:bg-accent"
                >
                  <Settings className="h-4 w-4" />
                  <span className="sr-only">Edit workspace</span>
                </Button>
              </Link>
            </div>
          );
        })}
      </div>
    </div>
  );
}
