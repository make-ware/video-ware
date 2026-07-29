'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createWorkspaceService } from '@/services/workspace';
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
import { UserPlus, Trash2, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import type { WorkspaceMember, User } from '@project/shared';
import Link from 'next/link';

/** PocketBase surfaces failures as `ClientResponseError`, which carries `status`. */
function errorStatus(error: unknown): number | undefined {
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status: unknown }).status;
    return typeof status === 'number' ? status : undefined;
  }
  return undefined;
}

/**
 * Turn an add-member failure into something a human can act on.
 *
 * 404 covers both "no such account" and "you are not a member of that workspace" —
 * the endpoint returns the same status for each on purpose, so it cannot be used to
 * probe for workspace ids.
 */
function addMemberErrorMessage(error: unknown): string {
  switch (errorStatus(error)) {
    case 404:
      return 'No account exists for that email address. Ask them to sign up first.';
    case 400:
      return error instanceof Error && error.message
        ? error.message
        : 'That email address is not valid.';
    case 401:
    case 403:
      return 'You do not have permission to add members to this workspace.';
    default:
      return 'Failed to add member';
  }
}

export default function WorkspaceManagePage() {
  const params = useParams();
  const router = useRouter();
  const workspaceId = params.workspaceId as string;
  const { user: currentUser } = useAuth();
  const { pb } = usePocketBase();

  const workspaceService = useMemo(() => createWorkspaceService(pb), [pb]);

  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [workspaceName, setWorkspaceName] = useState('');

  // Add member state
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
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

  // Add member by exact email address. There is no user search: `Users` reads are
  // scoped to co-members, so a search could only ever return people who are already
  // in a workspace with you.
  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = inviteEmail.trim();
    if (!email) return;

    try {
      setIsAdding(true);
      const result = await workspaceService.addMemberByEmail(
        workspaceId,
        email
      );

      if (result.created) {
        toast.success(`Added ${email}`);
      } else {
        toast.info(`${email} is already a member`);
      }

      setInviteEmail('');
      await fetchDetails();
      setIsAddDialogOpen(false);
    } catch (error) {
      console.error('Failed to add member:', error);
      toast.error(addMemberErrorMessage(error));
    } finally {
      setIsAdding(false);
    }
  };

  // Remove member. Takes the membership row's stored UserRef rather than an
  // expanded user, so an orphaned row (deleted account) stays removable.
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
              <Button onClick={() => setInviteEmail('')}>
                <UserPlus className="h-4 w-4 mr-2" />
                Add Member
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Member</DialogTitle>
                <DialogDescription>
                  Enter the email address of an existing account. Everyone in
                  this workspace can see each other&apos;s name and email, and
                  new members get access to all of its media, timelines and
                  renders.
                </DialogDescription>
              </DialogHeader>

              <form onSubmit={handleAddMember} className="flex gap-2 my-4">
                <Input
                  type="email"
                  autoComplete="email"
                  placeholder="name@example.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  disabled={isAdding}
                />
                <Button
                  type="submit"
                  disabled={isAdding || !inviteEmail.trim()}
                >
                  {isAdding ? 'Adding…' : 'Add'}
                </Button>
              </form>
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
                const userId = member.UserRef as string;

                return (
                  <TableRow key={member.id}>
                    <TableCell>
                      {/*
                        Defensive: with Users reads widened to co-members, every
                        genuine member now resolves. An unresolvable UserRef should
                        be unreachable — WorkspaceMembers.UserRef is a REQUIRED
                        relation with cascadeDelete: false, so PocketBase refuses to
                        delete a user that a membership row still points at
                        ("record is part of a required relation reference"), and an
                        orphan cannot be created through the API.

                        Still rendered rather than dropped, because the previous
                        `return null` was what silently desynced this table from the
                        member count above it. If the state ever does arise (a raw
                        SQL delete, or a future change to cascadeDelete), it shows up
                        and stays removable instead of vanishing.
                      */}
                      {user ? (
                        <div className="flex items-center gap-3">
                          <Avatar>
                            <AvatarImage
                              src={
                                user.avatar
                                  ? pb.files.getURL(user, user.avatar)
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
                      ) : (
                        <div className="flex items-center gap-3">
                          <Avatar>
                            <AvatarFallback>?</AvatarFallback>
                          </Avatar>
                          <div>
                            <div className="font-medium text-muted-foreground">
                              Unknown user
                              <Badge variant="outline" className="ml-2">
                                Orphaned
                              </Badge>
                            </div>
                            <div className="text-sm text-muted-foreground font-mono">
                              {userId}
                            </div>
                          </div>
                        </div>
                      )}
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
                                {user ? user.name || user.email : userId}
                              </span>{' '}
                              from this workspace?
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => handleRemoveMember(userId)}
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
