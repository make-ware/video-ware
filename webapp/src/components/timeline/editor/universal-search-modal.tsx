'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, ImageIcon, Loader2, Plus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SpriteAnimator } from '@/components/sprite/sprite-animator';
import { useTimeline } from '@/hooks/use-timeline';
import { useUniversalSearch } from '@/hooks/use-universal-search';
import {
  SEARCH_CATEGORIES,
  type SearchCategory,
  type SearchResult,
} from '@/services/search';
import { toast } from 'sonner';

interface UniversalSearchModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const PER_PAGE = 5;

export function UniversalSearchModal({
  open,
  onOpenChange,
}: UniversalSearchModalProps) {
  const { addClip } = useTimeline();
  const [category, setCategory] = useState<SearchCategory>('metadata');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);

  const { results, total, isFetching, hasQuery } = useUniversalSearch(
    category,
    query,
    page,
    PER_PAGE
  );

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  const handleAdd = async (result: SearchResult) => {
    try {
      await addClip(result.mediaId, result.start, result.end, result.clipId);
      toast.success('Added to timeline');
      // Keep the modal open so editors can add several clips in one session.
    } catch {
      toast.error('Failed to add clip');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0" showCloseButton={false}>
        <DialogHeader className="sr-only">
          <DialogTitle>Search clips</DialogTitle>
          <DialogDescription>
            Find clips by metadata, objects, transcripts, or tags and add them
            to the timeline.
          </DialogDescription>
        </DialogHeader>

        <Command shouldFilter={false}>
          <div className="border-b px-3 pt-3">
            <Tabs
              value={category}
              onValueChange={(v) => {
                setCategory(v as SearchCategory);
                setPage(0); // restart paging when the category changes
              }}
            >
              <TabsList className="w-full">
                {SEARCH_CATEGORIES.map((c) => (
                  <TabsTrigger key={c.id} value={c.id}>
                    {c.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <CommandInput
              autoFocus
              value={query}
              onValueChange={(v) => {
                setQuery(v);
                setPage(0); // restart paging when the query changes
              }}
              placeholder={`Search ${category}…`}
            />
          </div>

          <CommandList className="max-h-[420px]">
            <CommandEmpty>
              {!hasQuery
                ? `Type to search ${category}…`
                : isFetching
                  ? 'Searching…'
                  : `No ${category} matches for “${query.trim()}”`}
            </CommandEmpty>

            {results.length > 0 && (
              <CommandGroup>
                {results.map((result) => (
                  <SearchResultRow
                    key={result.key}
                    result={result}
                    onAdd={() => handleAdd(result)}
                  />
                ))}
              </CommandGroup>
            )}
          </CommandList>

          {total > 0 && (
            <div className="flex items-center justify-between border-t px-3 py-2">
              <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
                {isFetching && <Loader2 className="size-3 animate-spin" />}
                {total} {total === 1 ? 'result' : 'results'}
              </span>
              {totalPages > 1 && (
                <div className="flex items-center gap-2">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    aria-label="Previous page"
                    disabled={page === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  >
                    <ChevronLeft className="size-4" />
                  </Button>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {page + 1} / {totalPages}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    aria-label="Next page"
                    disabled={page >= totalPages - 1}
                    onClick={() =>
                      setPage((p) => Math.min(totalPages - 1, p + 1))
                    }
                  >
                    <ChevronRight className="size-4" />
                  </Button>
                </div>
              )}
            </div>
          )}
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function SearchResultRow({
  result,
  onAdd,
}: {
  result: SearchResult;
  onAdd: () => void;
}) {
  // Preview plays on hover (desktop) or while pinned via tap (mobile/touch).
  const [hovering, setHovering] = useState(false);
  const [pinned, setPinned] = useState(false);
  const previewing = hovering || pinned;

  return (
    <CommandItem
      value={result.key}
      // Selection (Enter / row click) intentionally does nothing — inserting is
      // only via the explicit CTA button below.
      onSelect={() => {}}
      className="flex items-center gap-3 py-2"
    >
      <button
        type="button"
        aria-label="Preview clip"
        // Keep the thumbnail out of the tab order so Tab steps through one CTA
        // (the insert button) per result; preview is hover/tap only.
        tabIndex={-1}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        onClick={(e) => {
          e.stopPropagation();
          setPinned((p) => !p);
        }}
        className="bg-muted relative h-[72px] w-32 shrink-0 cursor-pointer overflow-hidden rounded"
      >
        {result.media?.spriteFileRef ? (
          <SpriteAnimator
            media={result.media}
            start={result.start}
            end={result.end}
            isHovering={previewing}
            fallbackIcon={<ImageIcon className="size-5 opacity-40" />}
          />
        ) : result.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={result.thumbnailUrl}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="text-muted-foreground flex h-full w-full items-center justify-center">
            <ImageIcon className="size-5" />
          </div>
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">
            {result.mediaName}
          </span>
          <span className="text-muted-foreground shrink-0 text-xs">
            {formatTime(result.start)}–{formatTime(result.end)}
          </span>
        </div>
        {result.snippet && (
          <p className="text-muted-foreground line-clamp-2 text-xs">
            {result.snippet}
          </p>
        )}
        {result.category !== 'metadata' && (
          <Badge variant="secondary" className="mt-1">
            {Math.round(result.score * 100)}%
          </Badge>
        )}
      </div>

      <Button
        size="icon"
        variant="default"
        className="size-9 shrink-0"
        aria-label="Add to timeline"
        onClick={(e) => {
          e.stopPropagation();
          onAdd();
        }}
      >
        <Plus className="size-4" />
      </Button>
    </CommandItem>
  );
}

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
