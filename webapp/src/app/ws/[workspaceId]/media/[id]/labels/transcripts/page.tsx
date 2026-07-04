'use client';

import { useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { LabelType, type LabelSpeech } from '@project/shared';
import { useMediaTranscripts } from '@/hooks/use-media-transcripts';
import { useCreateClipFromLabel } from '@/components/labels/inspector/use-create-clip-from-label';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Copy, Scissors, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatClipTime } from '@/utils/format-clip-time';

/** Gap between consecutive selected segments that we consider noteworthy. */
const GAP_THRESHOLD_SECONDS = 1;

export default function LabelTranscriptsPage() {
  const params = useParams();
  const mediaId = params.id as string;
  const { transcripts, isLoading } = useMediaTranscripts(mediaId);
  const createClip = useCreateClipFromLabel();

  const [query, setQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    new Set()
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return transcripts;
    return transcripts.filter((t) => t.transcript.toLowerCase().includes(q));
  }, [transcripts, query]);

  const fullText = useMemo(
    () => transcripts.map((t) => t.transcript).join(' '),
    [transcripts]
  );

  const selectedSegments = useMemo(
    () =>
      transcripts
        .filter((t) => selectedIds.has(t.id))
        .sort((a, b) => a.start - b.start),
    [transcripts, selectedIds]
  );

  const selectionRange =
    selectedSegments.length > 0
      ? {
          start: selectedSegments[0].start,
          end: Math.max(...selectedSegments.map((s) => s.end)),
        }
      : null;

  const hasGaps = useMemo(() => {
    for (let i = 1; i < selectedSegments.length; i++) {
      const gap = selectedSegments[i].start - selectedSegments[i - 1].end;
      if (gap > GAP_THRESHOLD_SECONDS) return true;
    }
    return false;
  }, [selectedSegments]);

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleCreateSingle = (segment: LabelSpeech) => {
    createClip.mutate({
      kind: 'single',
      labelType: LabelType.SPEECH,
      record: segment,
    });
  };

  const handleCreateMerged = () => {
    createClip.mutate(
      { kind: 'merge-speech', segments: selectedSegments },
      { onSuccess: () => setSelectedIds(new Set()) }
    );
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(fullText);
    toast.success('Transcript copied to clipboard');
  };

  if (isLoading) {
    return (
      <div className="flex justify-center p-8">
        <Loader2 className="animate-spin h-8 w-8 text-primary" />
      </div>
    );
  }

  return (
    <div className="h-full">
      <Card className="h-full flex flex-col">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Transcripts</CardTitle>
            <CardDescription>
              {transcripts.length} speech segments found
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={copyToClipboard}>
            <Copy className="h-4 w-4 mr-2" />
            Copy Full Text
          </Button>
        </CardHeader>
        <CardContent className="flex-1 overflow-hidden p-0 flex flex-col">
          <Tabs defaultValue="list" className="flex-1 flex flex-col min-h-0">
            <div className="px-6 flex items-center gap-3 flex-wrap">
              <TabsList>
                <TabsTrigger value="list">Segments</TabsTrigger>
                <TabsTrigger value="raw">Raw Text</TabsTrigger>
              </TabsList>
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search transcript…"
                  className="pl-8 h-8"
                />
              </div>
            </div>

            <TabsContent value="list" className="flex-1 overflow-hidden mt-2">
              <ScrollArea className="h-full">
                <div className="p-6 pt-0 space-y-3">
                  {filtered.length === 0 ? (
                    <p className="text-muted-foreground text-center py-8">
                      {query
                        ? 'No segments match your search.'
                        : 'No transcripts found.'}
                    </p>
                  ) : (
                    filtered.map((t) => (
                      <div
                        key={t.id}
                        className="group flex items-start gap-3 p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                      >
                        <Checkbox
                          checked={selectedIds.has(t.id)}
                          onCheckedChange={() => toggleSelected(t.id)}
                          className="mt-1"
                          aria-label="Select segment"
                        />
                        <div className="text-xs font-mono text-muted-foreground whitespace-nowrap pt-1">
                          {formatClipTime(t.start)} – {formatClipTime(t.end)}
                        </div>
                        <p className="text-sm leading-relaxed flex-1">
                          {t.transcript}
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                          onClick={() => handleCreateSingle(t)}
                          disabled={createClip.isPending}
                          title="Create clip from this segment"
                        >
                          <Scissors className="h-3.5 w-3.5 mr-1.5" />
                          Create clip
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="raw" className="flex-1 overflow-hidden mt-2">
              <ScrollArea className="h-full">
                <div className="p-6 pt-0">
                  <div className="p-6 bg-muted/30 rounded-lg border whitespace-pre-wrap leading-relaxed">
                    {fullText || (
                      <span className="text-muted-foreground italic">
                        No transcript content available.
                      </span>
                    )}
                  </div>
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>

          {selectedSegments.length > 0 && selectionRange && (
            <div className="border-t px-6 py-3 flex items-center justify-between gap-3 flex-wrap bg-background">
              <div className="text-sm">
                <span className="font-medium">
                  {selectedSegments.length}{' '}
                  {selectedSegments.length === 1 ? 'segment' : 'segments'}
                </span>{' '}
                <span className="text-muted-foreground font-mono">
                  {formatClipTime(selectionRange.start)} –{' '}
                  {formatClipTime(selectionRange.end)}
                </span>
                {hasGaps && (
                  <span className="text-muted-foreground">
                    {' '}
                    · selection has gaps; the clip spans them
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedIds(new Set())}
                >
                  <X className="h-4 w-4 mr-1" />
                  Clear
                </Button>
                <Button
                  size="sm"
                  onClick={handleCreateMerged}
                  disabled={createClip.isPending}
                >
                  {createClip.isPending ? (
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  ) : (
                    <Scissors className="h-4 w-4 mr-1.5" />
                  )}
                  Create clip from selection
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
