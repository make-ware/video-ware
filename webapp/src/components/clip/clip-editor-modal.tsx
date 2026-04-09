'use client';

import React, { useState, useCallback, useMemo, useEffect } from 'react';
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
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Scissors,
  Edit,
  AlertCircle,
  Check,
  X,
  Clock,
  Layers,
  Trash2,
  Palette,
  Type,
} from 'lucide-react';
import { VideoPlayerUI } from '@/components/video/video-player-ui';
import { TrimHandles } from '@/components/video/trim-handles';
import {
  SegmentEditor,
  type Segment,
} from '@/components/timeline/segment-editor';
import { TimeInput } from '@/components/timeline/time-input';
import { useClipEditor } from './use-clip-editor';
import { useWorkspace } from '@/hooks/use-workspace';
import { MediaClipMutator } from '@project/shared/mutator';
import {
  ClipType,
  calculateDuration,
  calculateEffectiveDuration,
} from '@project/shared';
import type { Media, MediaClip } from '@project/shared';
import type {
  ExpandedMedia,
  ExpandedMediaClip,
  ExpandedTimelineClip,
} from '@/types/expanded-types';
import { formatClipTime } from '@/utils/format-clip-time';
import pb from '@/lib/pocketbase-client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// --- Preset colors for timeline clips ---

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

// --- Props types ---

interface ClipEditorModalBase {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ClipEditorCreateProps extends ClipEditorModalBase {
  mode: 'create';
  media: Media | ExpandedMedia;
  onClipCreated?: (clipId: string) => void;
  onAddToTimeline?: (
    mediaId: string,
    start: number,
    end: number,
    mediaClipId: string
  ) => Promise<void>;
}

interface ClipEditorEditMediaClipProps extends ClipEditorModalBase {
  mode: 'edit-media-clip';
  media: Media | ExpandedMedia;
  clip: MediaClip | ExpandedMediaClip;
  onClipUpdated?: () => void;
}

interface ClipEditorEditTimelineClipProps extends ClipEditorModalBase {
  mode: 'edit-timeline-clip';
  clip: ExpandedTimelineClip;
  onSave: (updates: Record<string, unknown>) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClipUpdated?: () => void;
}

export type ClipEditorModalProps =
  | ClipEditorCreateProps
  | ClipEditorEditMediaClipProps
  | ClipEditorEditTimelineClipProps;

// --- Helper to extract media from props ---

function getMedia(
  props: ClipEditorModalProps
): Media | ExpandedMedia | undefined {
  if (props.mode === 'create' || props.mode === 'edit-media-clip') {
    return props.media;
  }
  return props.clip.expand?.MediaRef;
}

function getInitialTimes(props: ClipEditorModalProps) {
  if (props.mode === 'create') {
    return {
      start: 0,
      end: props.media.duration,
    };
  }
  return { start: props.clip.start, end: props.clip.end };
}

function getInitialSegments(
  props: ClipEditorModalProps
): Segment[] | undefined {
  if (props.mode === 'create') return undefined;
  if (props.mode === 'edit-media-clip') {
    const clipData = props.clip.clipData as
      | { segments?: Segment[] }
      | undefined;
    return clipData?.segments;
  }
  // timeline clip: check meta and underlying MediaClipRef
  const meta = props.clip.meta as { segments?: Segment[] } | undefined;
  if (meta?.segments?.length) return meta.segments;
  const mediaClip = props.clip.expand?.MediaClipRef;
  const clipData = mediaClip?.clipData as { segments?: Segment[] } | undefined;
  return clipData?.segments;
}

function getIsComposite(props: ClipEditorModalProps): boolean {
  if (props.mode === 'create') return false;
  if (props.mode === 'edit-media-clip') {
    return props.clip.type === ClipType.COMPOSITE;
  }
  const mediaClip = props.clip.expand?.MediaClipRef;
  return mediaClip?.type === ClipType.COMPOSITE;
}

// --- Component ---

export function ClipEditorModal(props: ClipEditorModalProps) {
  const { open, onOpenChange, mode } = props;
  const { currentWorkspace } = useWorkspace();

  const media = getMedia(props);
  const { start: initialStart, end: initialEnd } = getInitialTimes(props);
  const initialSegments = getInitialSegments(props);
  const isComposite = getIsComposite(props);

  const editor = useClipEditor({
    media,
    initialStart,
    initialEnd,
    initialSegments,
    isComposite,
    minDuration: mode === 'create' ? 0 : 0.5,
  });

  const [isSaving, setIsSaving] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Timeline-specific fields
  const [title, setTitle] = useState('');
  const [color, setColor] = useState('bg-blue-600');

  // Reset timeline fields when clip changes
  useEffect(() => {
    if (mode === 'edit-timeline-clip' && open) {
      const clip = (props as ClipEditorEditTimelineClipProps).clip;
      const meta = clip.meta as
        | { title?: string; color?: string }
        | null
        | undefined;
      setTitle(meta?.title || '');
      setColor(meta?.color || 'bg-blue-600');
    }
  }, [mode, open, props]);

  const handleSave = useCallback(async () => {
    if (!editor.canSave) return;
    setIsSaving(true);

    try {
      if (mode === 'create') {
        const createProps = props as ClipEditorCreateProps;
        if (!currentWorkspace) {
          toast.error('No workspace selected');
          return;
        }
        const mutator = new MediaClipMutator(pb);
        const duration = calculateDuration(editor.startTime, editor.endTime);
        const newClip = await mutator.create({
          WorkspaceRef: currentWorkspace.id,
          MediaRef: createProps.media.id,
          type: ClipType.USER,
          start: editor.startTime,
          end: editor.endTime,
          duration,
          version: 1,
        });
        toast.success('Clip created');
        createProps.onClipCreated?.(newClip.id);
        if (createProps.onAddToTimeline) {
          await createProps.onAddToTimeline(
            createProps.media.id,
            editor.startTime,
            editor.endTime,
            newClip.id
          );
        }
        onOpenChange(false);
      } else if (mode === 'edit-media-clip') {
        const editProps = props as ClipEditorEditMediaClipProps;
        const mutator = new MediaClipMutator(pb);

        if (isComposite) {
          const sorted = [...editor.segments].sort((a, b) => a.start - b.start);
          const dur = calculateEffectiveDuration(
            0,
            editor.mediaDuration,
            sorted
          );
          await mutator.update(editProps.clip.id, {
            start: Math.min(...sorted.map((s) => s.start)),
            end: Math.max(...sorted.map((s) => s.end)),
            duration: dur,
            clipData: {
              ...(editProps.clip.clipData &&
              typeof editProps.clip.clipData === 'object'
                ? editProps.clip.clipData
                : {}),
              segments: sorted,
            },
          });
        } else {
          await mutator.update(editProps.clip.id, {
            start: editor.startTime,
            end: editor.endTime,
            duration: editor.endTime - editor.startTime,
          });
        }

        toast.success('Clip updated');
        editProps.onClipUpdated?.();
        onOpenChange(false);
      } else {
        // edit-timeline-clip
        const tlProps = props as ClipEditorEditTimelineClipProps;
        const clip = tlProps.clip;
        const mediaClip = clip.expand?.MediaClipRef;

        let finalStart = editor.startTime;
        let finalEnd = editor.endTime;

        if (isComposite && editor.segments.length > 0) {
          const sorted = [...editor.segments].sort((a, b) => a.start - b.start);
          finalStart = sorted[0].start;
          finalEnd = sorted[sorted.length - 1].end;
        }

        const updates: Record<string, unknown> = {
          start: finalStart,
          end: finalEnd,
          meta: {
            ...(typeof clip.meta === 'object' && clip.meta ? clip.meta : {}),
            title,
            color,
            ...(isComposite && editor.segments.length > 0
              ? { segments: editor.segments }
              : {}),
          },
        };

        await tlProps.onSave(updates);

        // Also update underlying MediaClip segments for composites
        if (isComposite && mediaClip?.id) {
          const mutator = new MediaClipMutator(pb);
          const sorted = [...editor.segments].sort((a, b) => a.start - b.start);
          const dur = calculateEffectiveDuration(finalStart, finalEnd, sorted);
          await mutator.update(mediaClip.id, {
            start: finalStart,
            end: finalEnd,
            duration: dur,
            clipData: {
              ...(mediaClip.clipData && typeof mediaClip.clipData === 'object'
                ? mediaClip.clipData
                : {}),
              segments: sorted,
            },
          });
        }

        toast.success('Clip updated');
        tlProps.onClipUpdated?.();
        onOpenChange(false);
      }
    } catch (err) {
      console.error('Failed to save clip:', err);
      toast.error('Failed to save clip');
    } finally {
      setIsSaving(false);
    }
  }, [
    mode,
    props,
    editor,
    isComposite,
    currentWorkspace,
    title,
    color,
    onOpenChange,
  ]);

  const handleDelete = useCallback(async () => {
    if (mode !== 'edit-timeline-clip') return;
    const tlProps = props as ClipEditorEditTimelineClipProps;
    if (!tlProps.onDelete) return;

    setIsDeleting(true);
    try {
      await tlProps.onDelete();
      toast.success('Clip removed');
      setDeleteConfirmOpen(false);
      onOpenChange(false);
    } catch (err) {
      console.error('Failed to remove clip:', err);
      toast.error('Failed to remove clip');
      setDeleteConfirmOpen(false);
    } finally {
      setIsDeleting(false);
    }
  }, [mode, props, onOpenChange]);

  const dialogTitle = useMemo(() => {
    if (mode === 'create') return 'Create Clip';
    if (mode === 'edit-timeline-clip') return 'Edit Timeline Clip';
    return 'Edit Clip';
  }, [mode]);

  const saveLabel = mode === 'create' ? 'Create Clip' : 'Save';
  const isTimelineMode = mode === 'edit-timeline-clip';

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
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? 'Removing...' : 'Remove'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl" showCloseButton={false}>
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle className="flex items-center gap-2">
                {mode === 'create' ? (
                  <Scissors className="h-5 w-5 text-primary" />
                ) : (
                  <Edit className="h-5 w-5 text-primary" />
                )}
                {dialogTitle}
              </DialogTitle>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onOpenChange(false)}
                  disabled={isSaving}
                >
                  <X className="h-4 w-4 mr-1" /> Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={
                    isSaving ||
                    !editor.canSave ||
                    (mode !== 'create' && !editor.hasChanges && !isTimelineMode)
                  }
                >
                  {isSaving ? (
                    'Saving...'
                  ) : (
                    <>
                      <Check className="h-4 w-4 mr-1" />
                      {saveLabel}
                    </>
                  )}
                </Button>
              </div>
            </div>
          </DialogHeader>

          <ScrollArea className="max-h-[80vh]">
            <div className="space-y-4 p-1">
              {/* Video Preview */}
              <div className="aspect-video bg-black rounded-lg overflow-hidden relative border shadow-sm">
                {editor.src ? (
                  <VideoPlayerUI
                    src={editor.src}
                    poster={editor.poster}
                    startTime={
                      isComposite
                        ? editor.segments[0]?.start || 0
                        : editor.startTime
                    }
                    endTime={
                      isComposite
                        ? editor.segments[editor.segments.length - 1]?.end ||
                          editor.mediaDuration
                        : editor.endTime
                    }
                    autoPlay={false}
                    preload="auto"
                    className="w-full h-full"
                    ref={editor.videoRef}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    No preview available
                  </div>
                )}
              </div>

              {/* Trim Controls */}
              {isComposite ? (
                <SegmentEditor
                  segments={editor.segments}
                  mediaDuration={editor.mediaDuration}
                  onChange={editor.setSegments}
                />
              ) : (
                <div className="space-y-4">
                  <TrimHandles
                    duration={editor.mediaDuration}
                    startTime={editor.startTime}
                    endTime={editor.endTime}
                    onChange={editor.handleTrimChange}
                    onScrub={editor.handleScrub}
                    currentTime={editor.currentVideoTime}
                    minDuration={mode === 'create' ? 0 : 0.5}
                  />
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">
                        Start Time
                      </Label>
                      <TimeInput
                        min={0}
                        max={editor.endTime}
                        value={editor.startTime}
                        onChange={editor.setStartTime}
                      />
                      <div className="text-xs font-mono text-muted-foreground">
                        {formatClipTime(editor.startTime)}
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">
                        End Time
                      </Label>
                      <TimeInput
                        min={editor.startTime}
                        max={editor.mediaDuration}
                        value={editor.endTime}
                        onChange={editor.setEndTime}
                      />
                      <div className="text-xs font-mono text-muted-foreground">
                        {formatClipTime(editor.endTime)}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Duration Display */}
              <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                <span className="text-sm font-medium flex items-center gap-2">
                  {isComposite ? (
                    <Layers className="h-4 w-4" />
                  ) : (
                    <Clock className="h-4 w-4" />
                  )}
                  {isComposite ? 'Effective Duration:' : 'Clip Duration:'}
                </span>
                <span className="text-sm font-mono font-bold">
                  {formatClipTime(Math.max(0, editor.effectiveDuration))}
                </span>
              </div>

              {/* Timeline-specific fields */}
              {isTimelineMode && (
                <>
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2">
                      <Type className="w-4 h-4" />
                      Display Name
                    </Label>
                    <Input
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Clip name"
                    />
                  </div>

                  <div className="space-y-3">
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
                </>
              )}

              {/* Original vs New (edit modes only) */}
              {mode !== 'create' && !isComposite && editor.hasChanges && (
                <div className="p-3 bg-muted/50 rounded-lg space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Original:</span>
                    <span className="font-mono">
                      {formatClipTime(initialStart)} -{' '}
                      {formatClipTime(initialEnd)} (
                      {formatClipTime(initialEnd - initialStart)})
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">New:</span>
                    <span className="font-mono text-primary">
                      {formatClipTime(editor.startTime)} -{' '}
                      {formatClipTime(editor.endTime)} (
                      {formatClipTime(editor.endTime - editor.startTime)})
                    </span>
                  </div>
                </div>
              )}

              {/* Validation Error */}
              {editor.validationError && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{editor.validationError}</AlertDescription>
                </Alert>
              )}
            </div>
          </ScrollArea>

          {/* Footer for timeline mode (delete button) */}
          {isTimelineMode &&
            (props as ClipEditorEditTimelineClipProps).onDelete && (
              <DialogFooter className="flex justify-between sm:justify-between items-center">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => setDeleteConfirmOpen(true)}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Remove
                </Button>
                <div />
              </DialogFooter>
            )}
        </DialogContent>
      </Dialog>
    </>
  );
}
