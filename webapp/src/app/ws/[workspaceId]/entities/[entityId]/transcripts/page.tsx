'use client';

import { useDeferredValue, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { speakerTranscriptLabel } from '@project/shared';
import type { EntityKind } from '@project/shared';
import { groupByMedia, useEntity } from '@/hooks/use-entities';
import { useEntityTranscripts } from '@/hooks/use-entity-transcripts';
import { ENTITY_KIND_META } from '@/components/entities/entity-kind';
import { PaginationControls } from '@/components/pagination/pagination-controls';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { formatClipTime } from '@/utils/format-clip-time';
import { ArrowLeft, Loader2, Search } from 'lucide-react';

const PER_PAGE = 25;

/** The transcript text with case-insensitive matches of `query` marked. */
function highlightMatches(text: string, query: string): React.ReactNode {
  const q = query.trim().toLowerCase();
  if (!q) return text;
  const lower = text.toLowerCase();
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let matchAt = lower.indexOf(q);
  while (matchAt !== -1) {
    if (matchAt > cursor) parts.push(text.slice(cursor, matchAt));
    parts.push(
      <mark key={matchAt} className="bg-primary/20 rounded px-0.5">
        {text.slice(matchAt, matchAt + q.length)}
      </mark>
    );
    cursor = matchAt + q.length;
    matchAt = lower.indexOf(q, cursor);
  }
  parts.push(text.slice(cursor));
  return parts;
}

/**
 * Everything an entity said across the workspace's media — the expanded,
 * server-searchable version of the old entity "Words" tab.
 */
export default function EntityTranscriptsPage() {
  const params = useParams();
  const workspaceId = params.workspaceId as string;
  const entityId = params.entityId as string;

  const { entity, isLoading: entityLoading } = useEntity(entityId);

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);

  const {
    utterances,
    page: currentPage,
    totalPages,
    totalItems,
    isLoading,
  } = useEntityTranscripts(entityId, deferredSearch, page, PER_PAGE);

  const mediaGroups = useMemo(() => groupByMedia(utterances), [utterances]);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  if (entityLoading) {
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

  const meta = ENTITY_KIND_META[entity.kind as EntityKind];
  const Icon = meta.icon;

  return (
    <div className="container mx-auto p-6 space-y-4">
      <Link
        href={`/ws/${workspaceId}/entities/${entityId}`}
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4 mr-1" />
        {entity.name}
      </Link>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3 flex-wrap">
            <Icon className="h-5 w-5 text-muted-foreground shrink-0" />
            <CardTitle>Spoken transcripts</CardTitle>
            <Badge variant="outline" className="capitalize">
              {String(entity.kind)}
            </Badge>
          </div>
          <CardDescription>
            {totalItems} {totalItems === 1 ? 'utterance' : 'utterances'} by{' '}
            {entity.name} across your media
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Search transcripts…"
          className="pl-8"
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center p-8">
          <Loader2 className="animate-spin h-6 w-6 text-primary" />
        </div>
      ) : utterances.length === 0 ? (
        deferredSearch.trim() ? (
          <div className="text-center py-12 space-y-3">
            <p className="text-muted-foreground">
              No transcripts match &quot;{deferredSearch.trim()}&quot;.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleSearchChange('')}
            >
              Clear search
            </Button>
          </div>
        ) : (
          <p className="text-muted-foreground text-center py-12">
            No spoken words attributed yet. Link this entity to a speaker in a
            media&apos;s Speakers → Identify tab.
          </p>
        )
      ) : (
        <div className="space-y-4">
          {mediaGroups.map((group) => (
            <div key={group.mediaId} className="border rounded-lg">
              <div className="px-4 py-2 border-b bg-muted/30 flex items-center justify-between">
                <Link
                  href={`/ws/${workspaceId}/media/${group.mediaId}/labels/speakers`}
                  className="font-medium hover:underline truncate"
                >
                  {group.name}
                </Link>
                <span className="text-xs text-muted-foreground shrink-0">
                  {group.rows.length}{' '}
                  {group.rows.length === 1 ? 'utterance' : 'utterances'}
                </span>
              </div>
              <div className="divide-y">
                {group.rows.map((u) => (
                  <div key={u.id} className="flex items-start gap-3 p-3">
                    <div className="w-40 shrink-0 space-y-1">
                      <div className="text-xs font-mono text-muted-foreground">
                        {formatClipTime(u.start)} – {formatClipTime(u.end)}
                      </div>
                      <Badge variant="secondary" className="text-[10px]">
                        {speakerTranscriptLabel(u.speakerId, entity.name)}
                      </Badge>
                    </div>
                    <p className="text-sm leading-relaxed flex-1">
                      {highlightMatches(u.transcript, deferredSearch)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <PaginationControls
        page={currentPage}
        totalPages={totalPages}
        onPageChange={setPage}
      />
    </div>
  );
}
