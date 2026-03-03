'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
} from '@/components/ui/alert-dialog';
import type { UseDirectoryCrudReturn } from '@/hooks/use-directory-crud';

type DirectoryDialogsProps = Pick<
  UseDirectoryCrudReturn,
  | 'renameTarget'
  | 'renameName'
  | 'setRenameName'
  | 'handleRenameClose'
  | 'handleRenameSubmit'
  | 'deleteTarget'
  | 'deleteError'
  | 'handleDeleteClose'
  | 'handleDeleteConfirm'
>;

export function DirectoryDialogs({
  renameTarget,
  renameName,
  setRenameName,
  handleRenameClose,
  handleRenameSubmit,
  deleteTarget,
  deleteError,
  handleDeleteClose,
  handleDeleteConfirm,
}: DirectoryDialogsProps) {
  return (
    <>
      {/* Rename dialog */}
      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) handleRenameClose();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Folder</DialogTitle>
            <DialogDescription>
              Enter a new name for &quot;{renameTarget?.name}&quot;.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            placeholder="Folder name"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRenameSubmit();
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={handleRenameClose}>
              Cancel
            </Button>
            <Button onClick={handleRenameSubmit} disabled={!renameName.trim()}>
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) handleDeleteClose();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Folder</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{deleteTarget?.name}&quot;?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && (
            <p className="text-sm text-destructive">{deleteError}</p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
