'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createWorkspaceService } from '@/services/workspace';
import { createUserService } from '@/services/user';
import { usePocketBase } from '@/contexts/pocketbase-context';
import { useAuth } from '@/hooks/use-auth';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Search, UserPlus, Trash2, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import type { WorkspaceMember, User } from '@project/shared';
import Link from 'next/link';

export default function WorkspaceManagePage() {
  const params = useParams();
  const router = useRouter();
  const workspaceId = params.workspaceId as string;
  const { user: currentUser } = useAuth();
  const { pb } = usePocketBase();

  const workspaceService = useMemo(() => createWorkspaceService(pb), [pb]);
  const userService = useMemo(() => createUserService(pb), [pb]);

  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [workspaceName, setWorkspaceName] = useState('');

  // Add member state
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isAdding, setIsAdding] = useState(false);

  // Fetch workspace details and members
  const fetchDetails = useCallback(async () => {
    try {
      setIsLoading(true);
      const [workspace, workspaceMembers] = await Promise.all([
        workspaceService.getWorkspace(workspaceId),
        workspaceService.getWorkspaceMembers(workspaceId),
      ]);

      if (!workspace) {
        toast.error('Workspace not found');
        router.push('/workspaces');
        return;
      }

      setWorkspaceName(workspace.name);
      setMembers(workspaceMembers);
    } catch (error) {
      console.error('Failed to fetch workspace details:', error);
      toast.error('Failed to load workspace details');
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId, router, workspaceService]);

  useEffect(() => {
    if (workspaceId) {
      fetchDetails();
    }
  }, [workspaceId, fetchDetails]);

  // Search users
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    try {
      setIsSearching(true);
      const result = await userService.searchUsers(searchQuery);

      // Filter out existing members
      const existingMemberIds = new Set(members.map((m) => m.UserRef));

      const availableUsers = result.items.filter(
        (user) => !existingMemberIds.has(user.id)
      );

      setSearchResults(availableUsers);
    } catch (error) {
      console.error('Failed to search users:', error);
      toast.error('Failed to search users');
    } finally {
      setIsSearching(false);
    }
  };

  // Add member
  const handleAddMember = async (userId: string) => {
    try {
      setIsAdding(true);
      await workspaceService.addMember(workspaceId, userId);
      toast.success('Member added successfully');
      setSearchResults((prev) => prev.filter((u) => u.id !== userId));
      await fetchDetails();
      setIsAddDialogOpen(false);
    } catch (error) {
      console.error('Failed to add member:', error);
      toast.error('Failed to add member');
    } finally {
      setIsAdding(false);
    }
  };

  // Remove member
  const handleRemoveMember = async (userId: string) => {
    if (members.length <= 1) {
      toast.error('Cannot remove the last member');
      return;
    }

    try {
      await workspaceService.removeMember(workspaceId, userId);
      toast.success('Member removed successfully');

      // If removed self, redirect
      if (userId === currentUser?.id) {
        router.push('/workspaces');
      } else {
        await fetchDetails();
      }
    } catch (error) {
      console.error('Failed to remove member:', error);
      toast.error(
        error instanceof Error ? error.message : 'Failed to remove member'
      );
    }
  };

  if (isLoading) {
    return (
      <div className="container mx-auto py-8 space-y-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/workspaces">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{workspaceName}</h1>
          <p className="text-muted-foreground">Manage workspace members</p>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Members</CardTitle>
            <CardDescription>
              {members.length} {members.length === 1 ? 'member' : 'members'} in
              this workspace
            </CardDescription>
          </div>
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button
                onClick={() => {
                  setSearchQuery('');
                  setSearchResults([]);
                }}
              >
                <UserPlus className="h-4 w-4 mr-2" />
                Add Member
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Member</DialogTitle>
                <DialogDescription>
                  Search for users by email or name to add them to the
                  workspace.
                </DialogDescription>
              </DialogHeader>

              <form onSubmit={handleSearch} className="flex gap-2 my-4">
                <Input
                  placeholder="Search by email or name..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                <Button
                  type="submit"
                  disabled={isSearching || !searchQuery.trim()}
                >
                  <Search className="h-4 w-4" />
                </Button>
              </form>

              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {searchResults.map((user) => (
                  <div
                    key={user.id}
                    className="flex items-center justify-between p-2 border rounded-md hover:bg-muted/50"
                  >
                    <div className="flex items-center gap-3">
                      <Avatar className="h-8 w-8">
                        <AvatarImage
                          src={
                            user.avatar
                              ? `/api/files/Users/${user.id}/${user.avatar}`
                              : undefined
                          }
                        />
                        <AvatarFallback>
                          {user.name?.[0] || user.email[0].toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="grid gap-0.5">
                        <div className="text-sm font-medium">
                          {user.name || 'Unnamed User'}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {user.email}
                        </div>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => handleAddMember(user.id)}
                      disabled={isAdding}
                    >
                      Add
                    </Button>
                  </div>
                ))}
                {searchResults.length === 0 && searchQuery && !isSearching && (
                  <p className="text-center text-sm text-muted-foreground py-4">
                    No users found
                  </p>
                )}
              </div>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => {
                const user = member.expand?.UserRef as User | undefined;
                if (!user) return null;

                return (
                  <TableRow key={member.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar>
                          <AvatarImage
                            src={
                              user.avatar
                                ? `/api/files/Users/${user.id}/${user.avatar}`
                                : undefined
                            }
                          />
                          <AvatarFallback>
                            {user.name?.[0] || user.email[0].toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <div className="font-medium">
                            {user.name || 'Unnamed User'}
                            {user.id === currentUser?.id && (
                              <Badge variant="secondary" className="ml-2">
                                You
                              </Badge>
                            )}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {user.email}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {new Date(member.created).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                            title="Remove member"
                            disabled={members.length <= 1}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Remove Member</AlertDialogTitle>
                            <AlertDialogDescription>
                              Are you sure you want to remove{' '}
                              <span className="font-semibold">
                                {user.name || user.email}
                              </span>{' '}
                              from this workspace?
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => handleRemoveMember(user.id)}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              Remove
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
