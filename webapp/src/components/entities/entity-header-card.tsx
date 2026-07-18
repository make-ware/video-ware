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
    <Card className="shrink-0 py-3 gap-2">
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 px-4">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
            <CardTitle className="text-base">{entity.name}</CardTitle>
            <Badge variant="outline" className="capitalize">
              {String(entity.kind)}
            </Badge>
            {aliases.map((alias) => (
              <Badge key={alias} variant="secondary">
                {alias}
              </Badge>
            ))}
          </div>
          {entity.description && (
            <CardDescription className="truncate">
              {entity.description}
            </CardDescription>
          )}
        </div>
        <Button asChild variant="outline" size="sm" className="shrink-0">
          <Link href={`/ws/${workspaceId}/entities/${entity.id}/transcripts`}>
            <MessageSquareText className="h-4 w-4 mr-1.5" />
            Spoken transcripts
            <ArrowRight className="h-4 w-4 ml-1.5" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="px-4">
        <div className="flex gap-2 overflow-x-auto">
          {tiles.map((tile) => (
            <div
              key={tile.label}
              className="flex-1 min-w-28 shrink-0 px-2.5 py-1.5 border rounded bg-muted/20"
            >
              <h4 className="text-[10px] font-medium uppercase text-muted-foreground">
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
