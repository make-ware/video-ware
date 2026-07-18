'use client';

import Link from 'next/link';
import type { Entity, EntityKind } from '@project/shared';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowRight, MessageSquareText } from 'lucide-react';
import { ENTITY_KIND_META } from './entity-kind';

export interface EntityHeaderStats {
  mediaCount: number;
  trackCount: number;
  utteranceCount: number;
  /** Sum of attributed labels across all label types. */
  labelTotal: number;
}

/**
 * Rich summary card for one entity: identity (kind icon, name, kind badge,
 * aliases, description), cross-media stat tiles, and the "Spoken
 * transcripts" call-to-action that replaced the old Words tab.
 */
export function EntityHeaderCard({
  workspaceId,
  entity,
  stats,
}: {
  workspaceId: string;
  entity: Entity;
  stats: EntityHeaderStats;
}) {
  const meta = ENTITY_KIND_META[entity.kind as EntityKind];
  const Icon = meta.icon;
  const aliases = Array.isArray(entity.aliases)
    ? (entity.aliases as string[])
    : [];

  const tiles = [
    { label: 'Media', value: stats.mediaCount },
    { label: 'Tracked Appearances', value: stats.trackCount },
    { label: 'Utterances', value: stats.utteranceCount },
    { label: 'Linked Labels', value: stats.labelTotal },
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="min-w-0 space-y-1.5">
          <div className="flex items-center gap-3 flex-wrap">
            <Icon className="h-5 w-5 text-muted-foreground shrink-0" />
            <CardTitle>{entity.name}</CardTitle>
            <Badge variant="outline" className="capitalize">
              {String(entity.kind)}
            </Badge>
            {aliases.map((alias) => (
              <Badge key={alias} variant="secondary">
                {alias}
              </Badge>
            ))}
          </div>
          <CardDescription>
            {entity.description || 'No description'}
          </CardDescription>
        </div>
        <Button asChild variant="outline" size="sm" className="shrink-0">
          <Link href={`/ws/${workspaceId}/entities/${entity.id}/transcripts`}>
            <MessageSquareText className="h-4 w-4 mr-1.5" />
            Spoken transcripts
            <ArrowRight className="h-4 w-4 ml-1.5" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {tiles.map((tile) => (
            <div key={tile.label} className="p-3 border rounded bg-muted/20">
              <h4 className="text-xs font-medium uppercase text-muted-foreground mb-1">
                {tile.label}
              </h4>
              <p className="text-sm font-mono">{tile.value}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
