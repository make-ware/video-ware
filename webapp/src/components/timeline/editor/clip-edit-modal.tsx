'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { useTimeline } from '@/hooks/use-timeline';
import { Trash2, Clock, Palette, Type } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { SpriteAnimator } from '@/components/sprite/sprite-animator';
import { ExpandedTimelineClip } from '@/types/expanded-types';
import { SegmentEditor, type Segment } from '../segment-editor';
import { TimeInput } from '../time-input';
import pb from '@/lib/pocketbase-client';
import { MediaClipMutator } from '@project/shared/mutator';
import { calculateEffectiveDuration } from '@project/shared';

interface ClipEditModalProps {
  clipId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const PRESET_COLORS = [
  { name: 'Blue', value: 'bg-blue-600' },
  { name: 'Indigo', value: 'bg-indigo-600' },
  { name: 'Violet', value: 'bg-violet-600' },
  { name: 'Purple', value: 'bg-purple-600' },
  { name: 'Pink', value: 'bg-pink-600' },
  { name: 'Rose', value: 'bg-rose-600' },
  { name: 'Red', value: 'bg-red-600' },
  { name: 'Orange', value: 'bg-orange-600' },
  { name: 'Amber', value: 'bg-amber-600' },
  { name: 'Yellow', value: 'bg-yellow-500' },
  { name: 'Lime', value: 'bg-lime-600' },
  { name: 'Green', value: 'bg-green-600' },
  { name: 'Emerald', value: 'bg-emerald-600' },
  { name: 'Teal', value: 'bg-teal-600' },
  { name: 'Cyan', value: 'bg-cyan-600' },
  { name: 'Sky', value: 'bg-sky-600' },
];

export function ClipEditModal({
  clipId,
  open,
  onOpenChange,
}: ClipEditModalProps) {
  const { timeline, updateClip, removeClip } = useTimeline();
  const clip = timeline?.clips.find((c) => c.id === clipId);

  const [title, setTitle] = useState('');
  const [color, setColor] = useState('');
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [previewTime, setPreviewTime] = useState<number | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Detect if this is a composite clip
  const expandedClip = clip as ExpandedTimelineClip;
  const mediaClip = expandedClip?.expand?.MediaClipRef;
  const isComposite = useMemo(() => {
    const clipData = mediaClip?.clipData as
      | { segments?: Segment[] }
      | undefined;
    return mediaClip?.type === 'composite' && !!clipData?.segments?.length;
  }, [mediaClip]);

  // Reset state when clip changes
  useEffect(() => {
    if (clip) {
      setTitle(
        (clip.meta && typeof clip.meta === 'object' && 'title' in clip.meta
          ? (clip.meta as { title?: string }).title
          : '') || ''
      );
      setColor(
        (clip.meta && typeof clip.meta === 'object' && 'color' in clip.meta
          ? (clip.meta as { color?: string }).color
          : '') || 'bg-blue-600'
      );
      setStart(clip.start);
      setEnd(clip.end);
      setPreviewTime(null);

      // Initialize segments for composite clips
      const clipData = mediaClip?.clipData as
        | { segments?: Segment[] }
        | undefined;
      if (isComposite && clipData?.segments) {
        setSegments(clipData.segments);
      } else {
        setSegments([]);
      }
    }
  }, [clip, mediaClip, isComposite]);

  if (!clip) return null;

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // Update start/end based on segments if composite
      let finalStart = start;
      let finalEnd = end;
      let finalDuration = end - start;

      if (isComposite && segments.length > 0) {
        const sortedSegs = [...segments].sort((a, b) => a.start - b.start);
        finalStart = sortedSegs[0].start;
        finalEnd = sortedSegs[sortedSegs.length - 1].end;
        finalDuration = calculateEffectiveDuration(
          finalStart,
          finalEnd,
          sortedSegs
        );
      }

      // Update TimelineClip
      await updateClip(clip.id, {
        start: finalStart,
        end: finalEnd,
        meta: {
          ...(typeof clip.meta === 'object' && clip.meta !== null
            ? clip.meta
            : {}),
          title,
          color,
          // Include segments in TimelineClip meta for timeline-level override
          ...(isComposite && segments.length > 0 ? { segments } : {}),
        },
      });

      // If composite, also update MediaClip.clipData.segments (source of truth)
      if (isComposite && mediaClip?.id) {
        const mutator = new MediaClipMutator(pb);
        const sortedSegs = [...segments].sort((a, b) => a.start - b.start);

        await mutator.update(mediaClip.id, {
          start: finalStart,
          end: finalEnd,
          duration: finalDuration,
          clipData: {
            ...(mediaClip.clipData && typeof mediaClip.clipData === 'object'
              ? mediaClip.clipData
              : {}),
            segments: sortedSegs,
          },
        });
      }

      toast.success('Clip updated');
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to update clip:', error);
      toast.error('Failed to update clip');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteClick = () => {
    setDeleteConfirmOpen(true);
  };

  const handleConfirmDelete = async () => {
    setIsDeleting(true);
    try {
      await removeClip(clip.id);
      toast.success('Clip removed');
      setDeleteConfirmOpen(false);
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to remove clip:', error);
      toast.error('Failed to remove clip');
      setDeleteConfirmOpen(false);
    } finally {
      setIsDeleting(false);
    }
  };

  const mediaName =
    expandedClip.expand?.MediaRef?.expand?.UploadRef?.name || 'Clip';
  const duration =
    isComposite && segments.length > 0
      ? segments.reduce((sum, seg) => sum + (seg.end - seg.start), 0)
      : end - start;
  const media = expandedClip.expand?.MediaRef;

  return (
    <>
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Clip</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove this clip from the timeline?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? 'Removing...' : 'Remove'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[550px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className={cn('w-3 h-3 rounded-full', color)} />
              Edit Clip
            </DialogTitle>
          </DialogHeader>

          <div className="grid gap-6 py-4">
            {/* Preview Section */}
            {media && (
              <div className="aspect-video w-full overflow-hidden rounded-md bg-muted border relative">
                <SpriteAnimator
                  media={media}
                  start={previewTime !== null ? previewTime : start}
                  end={previewTime !== null ? previewTime : end}
                  isHovering={previewTime === null} // Loop if not scrubbing
                  spriteFile={media?.expand?.spriteFileRef}
                />
                {previewTime !== null && (
                  <div className="absolute bottom-2 right-2 bg-black/75 text-white text-xs px-2 py-1 rounded font-mono">
                    {previewTime.toFixed(2)}s
                  </div>
                )}
              </div>
            )}

            {/* Title Section */}
            <div className="grid gap-2">
              <Label htmlFor="title" className="flex items-center gap-2">
                <Type className="w-4 h-4" />
                Display Name
              </Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={mediaName}
              />
              <p className="text-[10px] text-muted-foreground">
                Sets a custom name for this clip on the timeline.
              </p>
            </div>

            {/* Color Section */}
            <div className="grid gap-3">
              <Label className="flex items-center gap-2">
                <Palette className="w-4 h-4" />
                Clip Color
              </Label>
              <div className="grid grid-cols-8 gap-2">
                {PRESET_COLORS.map((pc) => (
                  <button
                    key={pc.value}
                    className={cn(
                      'w-full aspect-square rounded-md border-2 transition-all',
                      pc.value,
                      color === pc.value
                        ? 'border-white ring-2 ring-primary ring-offset-1'
                        : 'border-transparent hover:scale-110'
                    )}
                    onClick={() => setColor(pc.value)}
                    title={pc.name}
                  />
                ))}
              </div>
            </div>

            {/* Segment Editor for Composite Clips */}
            {isComposite && (
              <div className="border rounded-lg p-4 bg-muted/30">
                <SegmentEditor
                  segments={segments}
                  mediaDuration={media?.duration || 100}
                  onChange={setSegments}
                />
              </div>
            )}

            {/* Timing Section - Only show for non-composite clips */}
            {!isComposite && (
              <div className="grid gap-4">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    Clip Timing
                  </Label>
                  <div className="text-xs font-mono font-bold text-primary">
                    {duration.toFixed(2)}s
                  </div>
                </div>

                {/* Slider */}
                <div className="px-2 pt-2 pb-6">
                  <Slider
                    value={[start, end]}
                    max={media?.duration || 100}
                    step={0.1}
                    minStepsBetweenThumbs={0.5}
                    onValueChange={([newStart, newEnd]) => {
                      if (newStart !== start) {
                        setPreviewTime(newStart);
                      } else if (newEnd !== end) {
                        setPreviewTime(newEnd);
                      }
                      setStart(newStart);
                      setEnd(newEnd);
                    }}
                    onValueCommit={() => setPreviewTime(null)}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-1.5">
                    <Label
                      htmlFor="start"
                      className="text-xs text-muted-foreground font-normal"
                    >
                      Start (s)
                    </Label>
                    <TimeInput
                      id="start"
                      min={0}
                      max={end}
                      value={start}
                      onChange={setStart}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label
                      htmlFor="end"
                      className="text-xs text-muted-foreground font-normal"
                    >
                      End (s)
                    </Label>
                    <TimeInput
                      id="end"
                      min={start}
                      max={media?.duration}
                      value={end}
                      onChange={setEnd}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="flex justify-between sm:justify-between items-center mt-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={handleDeleteClick}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Remove
            </Button>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={handleSave} disabled={isSaving}>
                {isSaving ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
