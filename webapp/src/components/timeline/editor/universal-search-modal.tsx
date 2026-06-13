'use client';

import { useState } from 'react';
import { ImageIcon, Loader2, Plus } from 'lucide-react';
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

export function UniversalSearchModal({
  open,
  onOpenChange,
}: UniversalSearchModalProps) {
  const { addClip } = useTimeline();
  const [category, setCategory] = useState<SearchCategory>('metadata');
  const [query, setQuery] = useState('');

  const { results, isFetching, hasQuery } = useUniversalSearch(category, query);

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

        <Command
          shouldFilter={false}
          className="[&_[cmdk-input-wrapper]]:border-b-0"
        >
          <div className="border-b px-3 pt-3">
            <Tabs
              value={category}
              onValueChange={(v) => setCategory(v as SearchCategory)}
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
              onValueChange={setQuery}
              placeholder={`Search ${category}…`}
            />
          </div>

          <CommandList className="max-h-[360px]">
            <CommandEmpty>
              {!hasQuery
                ? `Type to search ${category}…`
                : isFetching
                  ? 'Searching…'
                  : `No ${category} matches for “${query.trim()}”`}
            </CommandEmpty>

            {results.length > 0 && (
              <CommandGroup
                heading={
                  isFetching ? (
                    <span className="flex items-center gap-1.5">
                      <Loader2 className="size-3 animate-spin" />
                      Searching…
                    </span>
                  ) : (
                    `Top ${results.length} ${category}`
                  )
                }
              >
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
  return (
    <CommandItem
      value={result.key}
      onSelect={onAdd}
      className="flex items-center gap-3"
    >
      <div className="bg-muted flex h-10 w-16 shrink-0 items-center justify-center overflow-hidden rounded">
        {result.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={result.thumbnailUrl}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <ImageIcon className="text-muted-foreground size-4" />
        )}
      </div>

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
      </div>

      {result.category !== 'metadata' && (
        <Badge variant="secondary" className="shrink-0">
          {Math.round(result.score * 100)}%
        </Badge>
      )}
      <Button
        size="icon"
        variant="ghost"
        className="size-8 shrink-0"
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
