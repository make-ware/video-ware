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
import { Pencil, Trash2, Plus, Play, Save, X } from 'lucide-react';
import { cn } from '@/lib/utils';
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

  // Creator state
  const [newStart, setNewStart] = useState('0');
  const [newEnd, setNewEnd] = useState('0');
  const [newText, setNewText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Editor state
  const [editStart, setEditStart] = useState('0');
  const [editEnd, setEditEnd] = useState('0');
  const [editText, setEditText] = useState('');

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
      <div className="flex justify-between items-center">
        <h3 className="font-semibold text-sm">Transcripts</h3>
        {!isCreating && (
          <Button size="sm" onClick={handleStartCreate} variant="outline">
            <Plus className="h-4 w-4 mr-2" />
            Add
          </Button>
        )}
      </div>

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
          <Card
            key={t.id}
            className={cn(
              'transition-colors',
              editingId === t.id && 'border-primary'
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
                      <span className="text-xs text-muted-foreground">End</span>
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
