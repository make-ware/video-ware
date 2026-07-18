'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEntity, useEntityStats } from '@/hooks/use-entities';
import { useEntityLabelCounts } from '@/hooks/use-entity-labels';
import { EntityHeaderCard } from '@/components/entities/entity-header-card';
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

  const { entity, isLoading } = useEntity(entityId);
  const stats = useEntityStats(entityId);
  const { counts, isLoading: countsLoading } = useEntityLabelCounts(entityId);

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
    <div className="container mx-auto p-6 space-y-4">
      <Link
        href={`/ws/${workspaceId}/entities?kind=${entity.kind}`}
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
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
        }}
      />

      <EntityLabelsBrowser
        workspaceId={workspaceId}
        entityId={entityId}
        entityName={entity.name}
        counts={counts}
        countsLoading={countsLoading}
      />
    </div>
  );
}
