'use client';

import { useState } from 'react';
import Link from 'next/link';
import { mediaDisplayName } from '@/hooks/use-entities';
import { useUntagMedia, type MediaTagWithMedia } from '@/hooks/use-media-tags';
import { LabelPreview } from '@/components/labels/label-preview';
import { PaginationControls } from '@/components/pagination/pagination-controls';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { ExternalLink, Film, X } from 'lucide-react';

const MEDIA_PER_PAGE = 50;

/**
 * Seconds one full-length preview sweep should take. A tag covers the whole
 * media, so a 1× sweep of an hour-long file would never visibly loop —
 * playback speed is derived from the duration to keep every media's sweep the
 * same watchable length.
 */
const FULL_SWEEP_SECONDS = 12;

/** Whole-media length as H:MM:SS (or M:SS under an hour). */
function formatMediaDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return 'Unknown length';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    : `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * The Tags tab's master–detail: the media manually tagged with this entity on
 * the left, a whole-media preview of the selected one on the right. Tags are
 * not labels — there is no time range to scrub, so the preview deliberately
 * spans 0 → duration, the span a tag actually asserts.
 */
export function EntityTaggedMediaPanel({
  workspaceId,
  entityId,
  entityName,
  tags,
}: {
  workspaceId: string;
  entityId: string;
  entityName: string;
  tags: MediaTagWithMedia[];
}) {
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string>();

  const selected = tags.find((tag) => tag.id === selectedId) ?? tags[0] ?? null;

  const totalPages = Math.ceil(tags.length / MEDIA_PER_PAGE);
  const currentPage = Math.min(page, Math.max(1, totalPages));
  const pagedTags = tags.slice(
    (currentPage - 1) * MEDIA_PER_PAGE,
    currentPage * MEDIA_PER_PAGE
  );

  return (
    <div className="flex-1 min-h-0 grid gap-3 grid-cols-1 grid-rows-[2fr_3fr] md:grid-rows-1 md:grid-cols-3">
      <Card className="min-h-0 flex flex-col md:col-span-1 py-3 gap-2">
        <CardHeader className="shrink-0 px-4">
          <CardTitle className="text-sm">Media · {tags.length}</CardTitle>
        </CardHeader>
        <CardContent className="flex-1 min-h-0 flex flex-col px-2 gap-2">
          <div className="flex-1 min-h-0 overflow-y-auto space-y-1">
            {pagedTags.map((tag) => (
              <TaggedMediaRow
                key={tag.id}
                tag={tag}
                entityId={entityId}
                isSelected={selected?.id === tag.id}
                onSelect={() => setSelectedId(tag.id)}
              />
            ))}
          </div>
          <PaginationControls
            page={currentPage}
            totalPages={totalPages}
            onPageChange={setPage}
            className="shrink-0"
          />
        </CardContent>
      </Card>

      <TaggedMediaPreviewPane
        key={selected?.id ?? 'none'}
        workspaceId={workspaceId}
        entityId={entityId}
        entityName={entityName}
        tag={selected}
      />
    </div>
  );
}

function TaggedMediaRow({
  tag,
  entityId,
  isSelected,
  onSelect,
}: {
  tag: MediaTagWithMedia;
  entityId: string;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const untagMedia = useUntagMedia();
  const media = tag.expand?.MediaRef;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        'w-full flex items-center gap-2.5 rounded-md border border-transparent px-2 py-2 text-left cursor-pointer transition-colors hover:bg-accent/50',
        isSelected && 'bg-secondary'
      )}
    >
      <Film className="h-4 w-4 text-muted-foreground shrink-0" />
      <span className="flex-1 text-sm font-medium truncate">
        {mediaDisplayName(media) || tag.MediaRef}
      </span>
      <Badge variant="outline" className="shrink-0 text-[10px] font-mono">
        {formatMediaDuration(media?.duration ?? 0)}
      </Badge>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        disabled={untagMedia.isPending}
        onClick={(event) => {
          event.stopPropagation();
          untagMedia.mutate({ mediaId: tag.MediaRef, entityId });
        }}
        title="Remove this tag from the media"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

/**
 * The selected tag's detail: a looping preview of the entire media (a tag
 * covers the whole file) plus where the tag came from and where to go next.
 */
function TaggedMediaPreviewPane({
  workspaceId,
  entityId,
  entityName,
  tag,
}: {
  workspaceId: string;
  entityId: string;
  entityName: string;
  tag: MediaTagWithMedia | null;
}) {
  const untagMedia = useUntagMedia();

  if (!tag) {
    return (
      <Card className="min-h-0 md:col-span-2">
        <CardContent className="flex items-center justify-center h-full text-muted-foreground">
          Select a media to preview it.
        </CardContent>
      </Card>
    );
  }

  const media = tag.expand?.MediaRef;
  const duration = media?.duration ?? 0;
  const name = mediaDisplayName(media) || tag.MediaRef;

  return (
    <Card className="min-h-0 flex flex-col md:col-span-2 py-3 gap-2">
      <CardHeader className="shrink-0 px-4">
        <CardTitle className="text-sm truncate">{name}</CardTitle>
        <CardDescription>
          Tagged with {entityName} — the tag covers the full{' '}
          {formatMediaDuration(duration)} of this media
        </CardDescription>
        <CardAction className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={untagMedia.isPending}
            onClick={() =>
              untagMedia.mutate({ mediaId: tag.MediaRef, entityId })
            }
          >
            <X className="h-4 w-4 mr-1.5" />
            Remove tag
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/ws/${workspaceId}/media/${tag.MediaRef}`}>
              <ExternalLink className="h-4 w-4 mr-1.5" />
              Open media
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 flex flex-col px-4 gap-3">
        <LabelPreview
          media={media}
          start={0}
          end={duration}
          speed={Math.max(1, duration / FULL_SWEEP_SECONDS)}
          className="shrink-0 h-32 md:h-48 mx-auto"
        />
        <div className="flex flex-wrap gap-2">
          <TagFact label="Scope" value="Whole media" />
          <TagFact
            label="Range"
            value={`0:00 – ${formatMediaDuration(duration)}`}
          />
          <TagFact
            label="Tagged"
            value={
              tag.created
                ? new Date(tag.created).toLocaleDateString()
                : 'Unknown'
            }
          />
        </div>
      </CardContent>
    </Card>
  );
}

function TagFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex-1 min-w-28 px-2.5 py-1.5 border rounded bg-muted/20">
      <h4 className="text-[10px] font-medium uppercase text-muted-foreground">
        {label}
      </h4>
      <p className="text-sm font-mono truncate">{value}</p>
    </div>
  );
}
