'use client';

import { useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { LabelType } from '@project/shared';
import { useMediaSpeakers } from '@/hooks/use-media-speakers';
import { useMediaLabelTracks } from '@/hooks/use-media-label-tracks';
import { useAssignTrackEntity } from '@/hooks/use-entities';
import { EntityPicker } from '@/components/labels/entity/entity-picker';
import { useCreateClipFromLabel } from '@/components/labels/inspector/use-create-clip-from-label';
import {
  deriveSpeakerSummaries,
  formatDiarizedTranscript,
  prettySpeakerId,
  speakerBadgeClass,
  speakerDotClass,
  speakerTranscriptLabelFor,
  type SpeakerUtterance,
} from '@/components/labels/speakers/speaker-utils';
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
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, Copy, Scissors, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { formatClipTime } from '@/utils/format-clip-time';
import { cn } from '@/lib/utils';

/** Gap between consecutive selected utterances that we consider noteworthy. */
const GAP_THRESHOLD_SECONDS = 1;

export default function LabelSpeakersPage() {
  const params = useParams();
  const mediaId = params.id as string;
  const workspaceId = params.workspaceId as string;
  const { utterances, isLoading } = useMediaSpeakers(mediaId);
  const { byTrackId } = useMediaLabelTracks(mediaId);
  const assignEntity = useAssignTrackEntity();
  const createClip = useCreateClipFromLabel();

  const [query, setQuery] = useState('');
  const [speakerFilter, setSpeakerFilter] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    new Set()
  );

  const speakers = useMemo(
    () => deriveSpeakerSummaries(utterances),
    [utterances]
  );
  const colorIndexBySpeaker = useMemo(
    () => new Map(speakers.map((s) => [s.speakerId, s.colorIndex])),
    [speakers]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return utterances.filter((u) => {
      if (speakerFilter && u.speakerId !== speakerFilter) return false;
      if (q && !u.transcript.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [utterances, query, speakerFilter]);

  const fullTranscript = useMemo(
    () => formatDiarizedTranscript(utterances, speakerTranscriptLabelFor),
    [utterances]
  );

  const selectedUtterances = useMemo(
    () =>
      utterances
        .filter((u) => selectedIds.has(u.id))
        .sort((a, b) => a.start - b.start),
    [utterances, selectedIds]
  );

  const selectionRange =
    selectedUtterances.length > 0
      ? {
          start: selectedUtterances[0].start,
          end: Math.max(...selectedUtterances.map((s) => s.end)),
        }
      : null;

  const hasGaps = useMemo(() => {
    for (let i = 1; i < selectedUtterances.length; i++) {
      const gap = selectedUtterances[i].start - selectedUtterances[i - 1].end;
      if (gap > GAP_THRESHOLD_SECONDS) return true;
    }
    return false;
  }, [selectedUtterances]);

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

  const handleCreateSingle = (utterance: SpeakerUtterance) => {
    createClip.mutate({
      kind: 'single',
      labelType: LabelType.SPEAKER,
      record: utterance,
    });
  };

  const handleCreateMerged = () => {
    createClip.mutate(
      { kind: 'merge-speaker', segments: selectedUtterances },
      { onSuccess: () => setSelectedIds(new Set()) }
    );
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(fullTranscript);
    toast.success('Diarized transcript copied to clipboard');
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
        <CardHeader className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Speakers</CardTitle>
            <CardDescription>
              {utterances.length}{' '}
              {utterances.length === 1 ? 'utterance' : 'utterances'} from{' '}
              {speakers.length} {speakers.length === 1 ? 'speaker' : 'speakers'}
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={copyToClipboard}>
            <Copy className="h-4 w-4 mr-2" />
            Copy Transcript
          </Button>
        </CardHeader>
        <CardContent className="flex-1 overflow-hidden p-0 flex flex-col">
          {speakers.length > 0 && (
            <div className="shrink-0 border-b px-6 pb-3">
              <div className="mb-2 flex items-center justify-between gap-2 flex-wrap">
                <h3 className="text-sm font-medium">Identify speakers</h3>
                <span className="text-xs text-muted-foreground">
                  Link a speaker to an entity to identify them here and across
                  media.
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {speakers.map((s) => {
                  const track = byTrackId.get(s.speakerId);
                  return (
                    <div
                      key={s.speakerId}
                      className="flex items-center gap-2 rounded-md border bg-muted/30 px-2.5 py-1.5"
                    >
                      <span
                        className={cn(
                          'h-2.5 w-2.5 rounded-full shrink-0',
                          speakerDotClass(s.colorIndex)
                        )}
                      />
                      <span
                        className="text-sm font-medium whitespace-nowrap"
                        title={`${s.utteranceCount} ${
                          s.utteranceCount === 1 ? 'utterance' : 'utterances'
                        } · ${formatClipTime(s.totalDuration)} speaking`}
                      >
                        {prettySpeakerId(s.speakerId)}
                      </span>
                      {track ? (
                        <EntityPicker
                          workspaceId={workspaceId}
                          value={track.EntityRef}
                          onChange={(entityId) =>
                            assignEntity.mutate({
                              trackId: track.id,
                              entityId,
                            })
                          }
                          disabled={assignEntity.isPending}
                          className="w-44"
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          No track record
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <Tabs
            defaultValue="conversation"
            className="flex-1 flex flex-col min-h-0"
          >
            <div className="px-6 pt-3 flex items-center gap-3 flex-wrap">
              <TabsList>
                <TabsTrigger value="conversation">Conversation</TabsTrigger>
                <TabsTrigger value="raw">Raw Text</TabsTrigger>
              </TabsList>
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search utterances…"
                  className="pl-8 h-8"
                />
              </div>
            </div>

            {speakers.length > 0 && (
              <div className="px-6 pt-3 flex items-center gap-2 flex-wrap">
                <Button
                  variant={speakerFilter === null ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-7"
                  onClick={() => setSpeakerFilter(null)}
                >
                  All
                </Button>
                {speakers.map((s) => (
                  <Button
                    key={s.speakerId}
                    variant={
                      speakerFilter === s.speakerId ? 'secondary' : 'ghost'
                    }
                    size="sm"
                    className="h-7 max-w-[14rem]"
                    onClick={() =>
                      setSpeakerFilter((prev) =>
                        prev === s.speakerId ? null : s.speakerId
                      )
                    }
                    title={`${s.name} · ${formatClipTime(
                      s.totalDuration
                    )} speaking time`}
                  >
                    <span
                      className={cn(
                        'h-2 w-2 rounded-full mr-1.5 shrink-0',
                        speakerDotClass(s.colorIndex)
                      )}
                    />
                    <span className="min-w-0 truncate">{s.name}</span>
                    <span className="ml-1.5 shrink-0 text-xs text-muted-foreground">
                      {s.utteranceCount}
                    </span>
                  </Button>
                ))}
              </div>
            )}

            <TabsContent
              value="conversation"
              className="flex-1 overflow-hidden mt-2"
            >
              <ScrollArea className="h-full">
                <div className="p-6 pt-0 space-y-3">
                  {filtered.length === 0 ? (
                    <p className="text-muted-foreground text-center py-8">
                      {query || speakerFilter
                        ? 'No utterances match your filters.'
                        : 'No speaker data found. Run label detection with speaker transcription enabled to see who says what.'}
                    </p>
                  ) : (
                    filtered.map((u) => (
                      <div
                        key={u.id}
                        className="flex gap-3 p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                      >
                        <Checkbox
                          checked={selectedIds.has(u.id)}
                          onCheckedChange={() => toggleSelected(u.id)}
                          className="mt-1 shrink-0"
                          aria-label="Select utterance"
                        />
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <Badge
                              variant="outline"
                              className={cn(
                                'max-w-[16rem] truncate font-medium',
                                speakerBadgeClass(
                                  colorIndexBySpeaker.get(u.speakerId) ?? 0
                                )
                              )}
                              title={speakerTranscriptLabelFor(u)}
                            >
                              {speakerTranscriptLabelFor(u)}
                            </Badge>
                            <span className="text-xs font-mono text-muted-foreground whitespace-nowrap">
                              {formatClipTime(u.start)} –{' '}
                              {formatClipTime(u.end)}
                            </span>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="ml-auto shrink-0"
                              onClick={() => handleCreateSingle(u)}
                              disabled={createClip.isPending}
                              title="Create clip from this utterance"
                            >
                              <Scissors className="h-3.5 w-3.5" />
                              <span className="sr-only">Create clip</span>
                            </Button>
                          </div>
                          <p className="text-sm leading-relaxed">
                            {u.transcript}
                          </p>
                        </div>
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
                    {fullTranscript || (
                      <span className="text-muted-foreground italic">
                        No speaker transcript available.
                      </span>
                    )}
                  </div>
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>

          {selectedUtterances.length > 0 && selectionRange && (
            <div className="border-t px-6 py-3 flex items-center justify-between gap-3 flex-wrap bg-background">
              <div className="text-sm">
                <span className="font-medium">
                  {selectedUtterances.length}{' '}
                  {selectedUtterances.length === 1 ? 'utterance' : 'utterances'}
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
