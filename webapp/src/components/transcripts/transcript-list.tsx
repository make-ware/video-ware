'use client';

import React, { useState } from 'react';
import {
  LabelSpeech,
  LabelSpeechInput,
  LabelSpeechUpdate,
} from '@project/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import {
  Pencil,
  Trash2,
  Plus,
  Play,
  Save,
  X,
  Scissors,
  Wand2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

interface TranscriptListProps {
  transcripts: LabelSpeech[];
  mediaId: string;
  workspaceId: string;
  onSeek: (time: number) => void;
  onCreate: (data: LabelSpeechInput) => Promise<void>;
  onUpdate: (id: string, data: LabelSpeechUpdate) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${m}:${s.toString().padStart(2, '0')}.${ms}`;
}

function generateSpeechHash(text: string, start: number, end: number): string {
  // Deterministic hash based on content and timestamp
  const input = `${text}|${start}|${end}|${Date.now()}`;
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

export function TranscriptList({
  transcripts,
  mediaId,
  workspaceId,
  onSeek,
  onCreate,
  onUpdate,
  onDelete,
}: TranscriptListProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Dead Air feature state
  const [isDeadAirDialogOpen, setIsDeadAirDialogOpen] = useState(false);
  const [maxGap, setMaxGap] = useState('0.5'); // Seconds

  // Creator state
  const [newStart, setNewStart] = useState('0');
  const [newEnd, setNewEnd] = useState('0');
  const [newText, setNewText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Editor state
  const [editStart, setEditStart] = useState('0');
  const [editEnd, setEditEnd] = useState('0');
  const [editText, setEditText] = useState('');

  const toggleSelection = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const handleCreateClipFromSelection = async () => {
    if (selectedIds.size === 0) return;

    try {
      setIsSubmitting(true);
      const selectedTranscripts = transcripts
        .filter((t) => selectedIds.has(t.id))
        .sort((a, b) => a.start - b.start);

      if (selectedTranscripts.length === 0) return;

      const first = selectedTranscripts[0];
      const last = selectedTranscripts[selectedTranscripts.length - 1];

      // Calculate total duration and range
      const start = first.start;
      const end = last.end;

      // Create creation payload
      const pb = (await import('@/lib/pocketbase-client')).default;
      const { MediaClipMutator } = await import('@project/shared/mutator');
      const { ClipType } = await import('@project/shared');

      const mutator = new MediaClipMutator(pb);

      await mutator.create({
        WorkspaceRef: workspaceId,
        MediaRef: mediaId,
        type: ClipType.SPEECH,
        start,
        end,
        duration: end - start,
        version: 1,
        clipData: {
          labelType: 'speech',
          sourceId: first.id, // Reference primary source
          sourceType: 'transcript',
          strategy: 'manual_selection',
          segments: selectedTranscripts.map((t) => ({
            start: t.start,
            end: t.end,
          })),
          rank: 1,
          score: 1.0,
        },
      });

      toast.success(`Created clip from ${selectedIds.size} segments`);
      setSelectedIds(new Set());
    } catch (error) {
      console.error('Failed to create clip:', error);
      toast.error('Failed to create clip');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemoveDeadAir = async () => {
    try {
      setIsSubmitting(true);
      const gapThreshold = parseFloat(maxGap);
      if (isNaN(gapThreshold) || gapThreshold < 0) {
        toast.error('Invalid gap duration');
        return;
      }

      // Determine which transcripts to process
      // If none selected, process ALL transcripts
      // If selected, process ONLY selected
      const sourceTranscripts =
        selectedIds.size > 0
          ? transcripts.filter((t) => selectedIds.has(t.id))
          : transcripts;

      if (sourceTranscripts.length === 0) {
        toast.error('No transcripts available to process');
        return;
      }

      // 1. Collect all words with absolute timing
      // We assume words are sorted by time if they come from sorted transcripts
      // but let's flatten and sort to be safe.

      interface WordTiming {
        word: string;
        startTime: number;
        endTime: number;
      }

      const allWords: WordTiming[] = [];

      sourceTranscripts.forEach((t) => {
        // Safe cast/access to words
        const words = (t.words as unknown as WordTiming[]) || [];
        if (words.length > 0) {
          allWords.push(...words);
        } else {
          // Fallback: If no word-level timing, treat the whole transcript segment as one "word"
          allWords.push({
            word: t.transcript,
            startTime: t.start,
            endTime: t.end,
          });
        }
      });

      // Sort by start time
      allWords.sort((a, b) => a.startTime - b.startTime);

      if (allWords.length === 0) {
        toast.error('No word timing data found');
        return;
      }

      // 2. Identify segments (jumping over dead air > gapThreshold)
      const segments: { start: number; end: number }[] = [];
      let currentSegmentStart = allWords[0].startTime;
      let currentSegmentEnd = allWords[0].endTime;

      for (let i = 1; i < allWords.length; i++) {
        const word = allWords[i];
        const gap = word.startTime - currentSegmentEnd;

        // If gap is significant (dead air) -> split
        // Note: we treat negative gap (overlap) as 0, effectively extending the segment
        if (gap > gapThreshold) {
          // Push current segment
          segments.push({ start: currentSegmentStart, end: currentSegmentEnd });

          // Start new segment
          currentSegmentStart = word.startTime;
          currentSegmentEnd = word.endTime;
        } else {
          // Extend current segment
          // We take max because sometimes words might be nested or unordered slightly if multiple speakers?
          // But we sorted by startTime. So just extending end is usually enough, but max is safer.
          currentSegmentEnd = Math.max(currentSegmentEnd, word.endTime);
        }
      }
      // Push the last segment
      segments.push({ start: currentSegmentStart, end: currentSegmentEnd });

      // 3. Create composite clip
      const pb = (await import('@/lib/pocketbase-client')).default;
      const { MediaClipMutator } = await import('@project/shared/mutator');
      const { ClipType, calculateEffectiveDuration } =
        await import('@project/shared');

      const mutator = new MediaClipMutator(pb);

      // Calculate overall start/end/duration from the computed segments
      // The clip itself spans from first segment start to last segment end
      // BUT playback will skip the gaps.
      // The backend/player needs to understand 'segments' to skip gaps.
      // For standard metadata 'start'/'end' we usually put the full range.
      const totalStart = segments[0].start;
      const totalEnd = segments[segments.length - 1].end;
      const effectiveDuration = calculateEffectiveDuration(
        totalStart,
        totalEnd,
        segments
      );

      await mutator.create({
        WorkspaceRef: workspaceId,
        MediaRef: mediaId,
        type: ClipType.COMPOSITE,
        start: totalStart,
        end: totalEnd,
        duration: effectiveDuration,
        version: 1,
        clipData: {
          labelType: 'speech',
          sourceType: 'transcript_composite',
          strategy: 'dead_air_removal',
          segments: segments,
          rank: 1,
          score: 1.0,
          gapThreshold: gapThreshold,
        },
      });

      toast.success(`Created composite clip with ${segments.length} segments`);
      setIsDeadAirDialogOpen(false);
      setSelectedIds(new Set()); // Clear selection
    } catch (error) {
      console.error('Failed to create composite clip:', error);
      toast.error('Failed to create composite clip');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStartCreate = () => {
    setIsCreating(true);
    setEditingId(null);
    setNewStart('0');
    setNewEnd('5'); // Default 5s duration
    setNewText('');
  };

  const handleCreate = async () => {
    try {
      setIsSubmitting(true);
      const start = parseFloat(newStart);
      const end = parseFloat(newEnd);

      if (isNaN(start) || isNaN(end)) {
        toast.error('Invalid time values');
        return;
      }

      await onCreate({
        WorkspaceRef: workspaceId,
        MediaRef: mediaId,
        transcript: newText,
        start,
        end,
        duration: end - start,
        confidence: 1.0,
        words: [],
        speechHash: generateSpeechHash(newText, start, end),
        languageCode: 'en-US',
      });
      setIsCreating(false);
    } catch (e) {
      console.error(e);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStartEdit = (t: LabelSpeech) => {
    setEditingId(t.id);
    setIsCreating(false);
    setEditStart(t.start.toString());
    setEditEnd(t.end.toString());
    setEditText(t.transcript);
  };

  const handleUpdate = async (id: string) => {
    try {
      setIsSubmitting(true);
      const start = parseFloat(editStart);
      const end = parseFloat(editEnd);

      if (isNaN(start) || isNaN(end)) {
        toast.error('Invalid time values');
        return;
      }

      await onUpdate(id, {
        transcript: editText,
        start,
        end,
        duration: end - start,
      });
      setEditingId(null);
    } catch (e) {
      console.error(e);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 pb-4">
      <div className="flex justify-between items-center bg-background sticky top-0 z-10 py-2 border-b">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-sm">Transcripts</h3>
          {selectedIds.size > 0 && (
            <span className="text-xs text-muted-foreground">
              ({selectedIds.size} selected)
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <Button
              size="sm"
              variant="secondary"
              onClick={handleCreateClipFromSelection}
              disabled={isSubmitting}
            >
              <Scissors className="h-4 w-4 mr-2" />
              Create Clip
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0"
            onClick={() => setIsDeadAirDialogOpen(true)}
            title="Remove Dead Air"
          >
            <Wand2 className="h-4 w-4" />
          </Button>
          {!isCreating && (
            <Button size="sm" onClick={handleStartCreate} variant="outline">
              <Plus className="h-4 w-4 mr-2" />
              Add
            </Button>
          )}
        </div>
      </div>

      <Dialog open={isDeadAirDialogOpen} onOpenChange={setIsDeadAirDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Dead Air</DialogTitle>
            <DialogDescription>
              Create a composite clip that automatically skips silence/gaps
              longer than the specified duration.
              {selectedIds.size > 0
                ? ` Processing ${selectedIds.size} selected transcripts.`
                : ' Processing all transcripts in the file.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="maxGap" className="text-right">
                Max Gap
              </Label>
              <Input
                id="maxGap"
                type="number"
                step="0.1"
                min="0"
                value={maxGap}
                onChange={(e) => setMaxGap(e.target.value)}
                className="col-span-3"
              />
            </div>
            <p className="text-xs text-muted-foreground ml-auto col-span-4">
              (Seconds) shorter than this will be kept. Longer gaps will be cut.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => setIsDeadAirDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleRemoveDeadAir} disabled={isSubmitting}>
              {isSubmitting ? 'Creating...' : 'Create Clip'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {isCreating && (
        <Card className="border-dashed border-2">
          <CardContent className="pt-4 space-y-3">
            <div className="flex gap-2">
              <div className="space-y-1 flex-1">
                <span className="text-xs text-muted-foreground">Start (s)</span>
                <Input
                  type="number"
                  step="0.1"
                  value={newStart}
                  onChange={(e) => setNewStart(e.target.value)}
                />
              </div>
              <div className="space-y-1 flex-1">
                <span className="text-xs text-muted-foreground">End (s)</span>
                <Input
                  type="number"
                  step="0.1"
                  value={newEnd}
                  onChange={(e) => setNewEnd(e.target.value)}
                />
              </div>
            </div>
            <Textarea
              placeholder="Enter transcript..."
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              className="min-h-[80px]"
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsCreating(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={handleCreate} disabled={isSubmitting}>
                Create
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {transcripts.map((t) => (
          <div key={t.id} className="flex items-start gap-2">
            <div className="pt-4">
              <Checkbox
                checked={selectedIds.has(t.id)}
                onCheckedChange={() => toggleSelection(t.id)}
              />
            </div>
            <Card
              className={cn(
                'transition-colors flex-1',
                editingId === t.id && 'border-primary',
                selectedIds.has(t.id) && 'bg-muted/30'
              )}
            >
              <CardContent className="p-3">
                {editingId === t.id ? (
                  <div className="space-y-3">
                    <div className="flex gap-2">
                      <div className="space-y-1 flex-1">
                        <span className="text-xs text-muted-foreground">
                          Start
                        </span>
                        <Input
                          type="number"
                          step="0.1"
                          value={editStart}
                          onChange={(e) => setEditStart(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1 flex-1">
                        <span className="text-xs text-muted-foreground">
                          End
                        </span>
                        <Input
                          type="number"
                          step="0.1"
                          value={editEnd}
                          onChange={(e) => setEditEnd(e.target.value)}
                        />
                      </div>
                    </div>
                    <Textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      className="min-h-[80px]"
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingId(null)}
                        disabled={isSubmitting}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => handleUpdate(t.id)}
                        disabled={isSubmitting}
                      >
                        <Save className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2 group">
                    <div className="flex justify-between items-start">
                      <div
                        className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded cursor-pointer hover:bg-muted-foreground/20 transition-colors"
                        onClick={() => onSeek(t.start)}
                      >
                        {formatTime(t.start)} - {formatTime(t.end)}
                      </div>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => onSeek(t.start)}
                        >
                          <Play className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => handleStartEdit(t)}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-destructive hover:text-destructive"
                          onClick={() => onDelete(t.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    <p className="text-sm text-foreground/90 whitespace-pre-wrap">
                      {t.transcript}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        ))}

        {transcripts.length === 0 && !isCreating && (
          <div className="text-center py-8 text-muted-foreground text-sm">
            No transcripts found.
          </div>
        )}
      </div>
    </div>
  );
}
