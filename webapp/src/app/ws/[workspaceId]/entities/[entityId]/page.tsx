'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  useDeleteEntity,
  useEntity,
  useEntityStats,
} from '@/hooks/use-entities';
import { useEntityLabelCounts } from '@/hooks/use-entity-labels';
import { useEntityTaggedMedia } from '@/hooks/use-media-tags';
import { EntityHeaderCard } from '@/components/entities/entity-header-card';
import {
  EntityDeleteDialog,
  EntityFormDialog,
} from '@/components/entities/entity-dialogs';
import { EntityLabelsBrowser } from '@/components/entities/entity-labels-browser';
import { ArrowLeft, Loader2 } from 'lucide-react';

/**
 * One entity: a rich summary card (identity + cross-media stats + link to
 * its spoken transcripts) above a per-label-type master–detail browser of
 * everything attributed to it across the workspace.
 */
export default function EntityDetailPage() {
  const params = useParams();
  const workspaceId = params.workspaceId as string;
  const entityId = params.entityId as string;

  const router = useRouter();
  const { entity, isLoading } = useEntity(entityId);
  const stats = useEntityStats(entityId);
  const { counts, isLoading: countsLoading } = useEntityLabelCounts(entityId);
  // Same query the browser's Tags tab reads — shared cache, one fetch.
  const { tags } = useEntityTaggedMedia(entityId);
  const deleteEntity = useDeleteEntity();

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const labelTotal = useMemo(
    () =>
      counts ? Object.values(counts).reduce((sum, count) => sum + count, 0) : 0,
    [counts]
  );

  if (isLoading) {
    return (
      <div className="flex justify-center p-8">
        <Loader2 className="animate-spin h-8 w-8 text-primary" />
      </div>
    );
  }

  if (!entity) {
    return (
      <div className="container mx-auto p-6 text-muted-foreground">
        Entity not found.
      </div>
    );
  }

  return (
    // 2.5625rem = NavigationBar's fixed h-10 content + its border-b. The
    // page itself never scrolls — each browser panel scrolls internally.
    <div className="container mx-auto px-6 py-3 h-[calc(100vh-2.5625rem)] flex flex-col gap-3">
      <Link
        href={`/ws/${workspaceId}/entities`}
        className="shrink-0 inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4 mr-1" />
        All entities
      </Link>

      <EntityHeaderCard
        workspaceId={workspaceId}
        entity={entity}
        stats={{
          mediaCount: stats.mediaCount,
          trackCount: stats.trackCount,
          utteranceCount: stats.utteranceCount,
          labelTotal,
          tagCount: tags.length,
        }}
        onEdit={() => setEditOpen(true)}
        onDelete={() => setDeleteOpen(true)}
      />

      <EntityFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        workspaceId={workspaceId}
        entity={entity}
      />

      <EntityDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        entity={entity}
        labelTotal={labelTotal}
        mediaCount={stats.mediaCount}
        isPending={deleteEntity.isPending}
        onConfirm={() =>
          deleteEntity.mutate(entity.id, {
            // The record is gone — staying would render "Entity not found."
            onSuccess: () => router.push(`/ws/${workspaceId}/entities`),
          })
        }
      />

      <div className="flex-1 min-h-0">
        <EntityLabelsBrowser
          workspaceId={workspaceId}
          entityId={entityId}
          entityName={entity.name}
          counts={counts}
          countsLoading={countsLoading}
        />
      </div>
    </div>
  );
}
