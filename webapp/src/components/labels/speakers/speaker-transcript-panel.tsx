'use client';

import { useMemo, useState } from 'react';
import { LabelType } from '@project/shared';
import { useMediaLabelTracks } from '@/hooks/use-media-label-tracks';
import { useAssignTrackEntity } from '@/hooks/use-entities';
import { EntityPicker } from '@/components/labels/entity/entity-picker';
import { useCreateClipFromLabel } from '@/components/labels/inspector/use-create-clip-from-label';
import {
  deriveSpeakerSummaries,
  prettySpeakerId,
  speakerBadgeClass,
  speakerDotClass,
  speakerTranscriptLabelFor,
  type SpeakerUtterance,
} from '@/components/labels/speakers/speaker-utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Loader2, Scissors, Search, X } from 'lucide-react';
import { formatClipTime } from '@/utils/format-clip-time';
import { cn } from '@/lib/utils';

interface SpeakerTranscriptPanelProps {
  /** Diarized speaker utterances, sorted by start (from useMediaSpeakers). */
  utterances: SpeakerUtterance[];
  isLoading: boolean;
  mediaId: string;
  workspaceId: string;
  /** Seek (and play) the video to a timestamp, in seconds. */
  onSeek: (timeSeconds: number) => void;
}

/**
 * Compact, sidebar-sized speaker transcript for the media viewer's Transcripts
 * tab — the dense counterpart of the full Labels → Speakers page. Lets an
 * editor identify each speaker (link their track to an Entity), read who says
 * what, seek the player by clicking an utterance, and cut clips from single
 * utterances or a merged selection. The parent tab owns vertical scrolling.
 */
export function SpeakerTranscriptPanel({
  utterances,
  isLoading,
  mediaId,
  workspaceId,
  onSeek,
}: SpeakerTranscriptPanelProps) {
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

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (utterances.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        No speaker data found. Run label detection with speaker transcription
        enabled to see who says what.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Identify speakers */}
      {speakers.length > 0 && (
        <div className="space-y-2 border-b pb-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-medium uppercase text-muted-foreground">
              Identify speakers
            </h3>
          </div>
          <div className="space-y-1.5">
            {speakers.map((s) => {
              const track = byTrackId.get(s.speakerId);
              return (
                <div
                  key={s.speakerId}
                  className="flex items-center gap-2 rounded-md border bg-muted/30 px-2 py-1.5"
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
                        assignEntity.mutate({ trackId: track.id, entityId })
                      }
                      disabled={assignEntity.isPending}
                      className="ml-auto w-40"
                    />
                  ) : (
                    <span className="ml-auto text-xs text-muted-foreground">
                      No track record
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Search + speaker filter */}
      <div className="space-y-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search utterances…"
            className="pl-8 h-8"
          />
        </div>
        {speakers.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5">
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
                variant={speakerFilter === s.speakerId ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 max-w-[10rem]"
                onClick={() =>
                  setSpeakerFilter((prev) =>
                    prev === s.speakerId ? null : s.speakerId
                  )
                }
                title={`${s.name} · ${formatClipTime(s.totalDuration)} speaking time`}
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
      </div>

      {/* Conversation */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            No utterances match your filters.
          </p>
        ) : (
          filtered.map((u) => (
            <div
              key={u.id}
              role="button"
              tabIndex={0}
              onClick={() => onSeek(u.start)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSeek(u.start);
                }
              }}
              className="flex gap-2 p-2.5 border rounded-lg cursor-pointer hover:bg-muted/50 transition-colors"
            >
              <div onClick={(e) => e.stopPropagation()}>
                <Checkbox
                  checked={selectedIds.has(u.id)}
                  onCheckedChange={() => toggleSelected(u.id)}
                  className="mt-0.5 shrink-0"
                  aria-label="Select utterance"
                />
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Badge
                    variant="outline"
                    className={cn(
                      'max-w-[12rem] truncate font-medium',
                      speakerBadgeClass(
                        colorIndexBySpeaker.get(u.speakerId) ?? 0
                      )
                    )}
                    title={speakerTranscriptLabelFor(u)}
                  >
                    {speakerTranscriptLabelFor(u)}
                  </Badge>
                  <span className="text-xs font-mono text-muted-foreground whitespace-nowrap">
                    {formatClipTime(u.start)} – {formatClipTime(u.end)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="ml-auto shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCreateSingle(u);
                    }}
                    disabled={createClip.isPending}
                    title="Create clip from this utterance"
                  >
                    <Scissors className="h-3.5 w-3.5" />
                    <span className="sr-only">Create clip</span>
                  </Button>
                </div>
                <p className="text-sm leading-relaxed">{u.transcript}</p>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Selection footer */}
      {selectedUtterances.length > 0 && selectionRange && (
        <div className="sticky bottom-0 -mx-3 sm:-mx-6 border-t bg-background px-3 sm:px-6 py-2.5 space-y-2">
          <div className="text-xs">
            <span className="font-medium">
              {selectedUtterances.length}{' '}
              {selectedUtterances.length === 1 ? 'utterance' : 'utterances'}
            </span>{' '}
            <span className="text-muted-foreground font-mono">
              {formatClipTime(selectionRange.start)} –{' '}
              {formatClipTime(selectionRange.end)}
            </span>
          </div>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="flex-1"
              onClick={() => setSelectedIds(new Set())}
            >
              <X className="h-4 w-4 mr-1" />
              Clear
            </Button>
            <Button
              size="sm"
              className="flex-1"
              onClick={handleCreateMerged}
              disabled={createClip.isPending}
            >
              {createClip.isPending ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <Scissors className="h-4 w-4 mr-1.5" />
              )}
              Create clip
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
