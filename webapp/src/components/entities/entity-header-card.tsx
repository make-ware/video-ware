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
import { ArrowRight, MessageSquareText, Pencil, Trash2 } from 'lucide-react';
import { ENTITY_KIND_META } from './entity-kind';

export interface EntityHeaderStats {
  mediaCount: number;
  trackCount: number;
  utteranceCount: number;
  /** Sum of attributed labels across all label types. */
  labelTotal: number;
  /** Manual whole-media tags — the browser's Tags tab lists them. */
  tagCount: number;
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
  onEdit,
  onDelete,
}: {
  workspaceId: string;
  entity: Entity;
  stats: EntityHeaderStats;
  /** Edit/delete actions render only when the page supplies a handler. */
  onEdit?: () => void;
  onDelete?: () => void;
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
    { label: 'Tagged Media', value: stats.tagCount },
  ];

  return (
    <Card className="shrink-0 py-3 gap-2">
      {/* Identity and actions stack on a phone — three buttons beside a
          wrapping name row leaves neither enough width. */}
      <CardHeader className="flex flex-col items-stretch gap-2 space-y-0 px-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4 sm:px-4">
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
            <CardDescription className="line-clamp-2 sm:truncate">
              {entity.description}
            </CardDescription>
          )}
        </div>
        <div className="flex items-center gap-2 sm:shrink-0">
          {onEdit && (
            <Button
              variant="outline"
              size="sm"
              onClick={onEdit}
              aria-label="Edit entity"
            >
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          {onDelete && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onDelete}
              className="text-destructive hover:text-destructive"
              aria-label="Delete entity"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
          <Button
            asChild
            variant="outline"
            size="sm"
            className="min-w-0 flex-1 sm:flex-none"
          >
            <Link href={`/ws/${workspaceId}/entities/${entity.id}/transcripts`}>
              <MessageSquareText className="h-4 w-4 mr-1.5 shrink-0" />
              <span className="truncate">
                <span className="hidden sm:inline">Spoken </span>
                transcripts
              </span>
              <ArrowRight className="h-4 w-4 ml-1.5 hidden shrink-0 sm:inline" />
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-3 sm:px-4">
        {/* Five tiles never fit a phone row; they scroll sideways rather than
            stacking into three rows of the page's fixed-height shell. */}
        <div className="flex gap-2 overflow-x-auto pb-0.5">
          {tiles.map((tile) => (
            <div
              key={tile.label}
              className="flex-1 min-w-24 shrink-0 px-2.5 py-1.5 border rounded bg-muted/20 sm:min-w-28"
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
