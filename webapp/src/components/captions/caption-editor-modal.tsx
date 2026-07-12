'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { TimeInput } from '@/components/timeline/time-input';
import { CaptionOverlay } from './caption-overlay';
import pb from '@/lib/pocketbase-client';
import { CaptionMutator } from '@project/shared/mutator';
import {
  CaptionType,
  DEFAULT_CAPTION_STYLE,
  DEFAULT_TITLE_STYLE,
  normalizeCaptionText,
  splitTextIntoCues,
  type Caption,
  type CaptionCue,
  type CaptionInput,
  type CaptionStyle,
} from '@project/shared';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDownToLine,
  ArrowUpToLine,
  FoldVertical,
  Plus,
  Trash2,
  WandSparkles,
} from 'lucide-react';
import { toast } from 'sonner';

const DEFAULT_DURATION = 5;

export interface CaptionEditorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  /** Existing caption to edit; omit to create a new one */
  caption?: Caption | null;
  /** Initial type when creating (caption vs. title screen) */
  defaultType?: CaptionType;
  /** Called with the created/updated record after a successful save */
  onSaved?: (caption: Caption) => void | Promise<void>;
}

function defaultStyleFor(type: CaptionType): CaptionStyle {
  return type === CaptionType.TITLE
    ? { ...DEFAULT_TITLE_STYLE }
    : { ...DEFAULT_CAPTION_STYLE };
}

/**
 * Create/edit dialog for captions and title screens.
 *
 * Works on the shared Caption model, so it can edit ad-hoc timeline
 * captions and media-attached transcript captions alike. Persistence goes
 * through CaptionMutator; the caller wires the result into a timeline (or
 * elsewhere) via onSaved.
 */
export function CaptionEditorModal({
  open,
  onOpenChange,
  workspaceId,
  caption,
  defaultType = CaptionType.CAPTION,
  onSaved,
}: CaptionEditorModalProps) {
  const isEditing = !!caption;

  const [name, setName] = useState('');
  const [captionType, setCaptionType] = useState<CaptionType>(defaultType);
  const [text, setText] = useState('');
  const [duration, setDuration] = useState(DEFAULT_DURATION);
  const [cues, setCues] = useState<CaptionCue[]>([]);
  const [animated, setAnimated] = useState(false);
  const [style, setStyle] = useState<CaptionStyle>(
    defaultStyleFor(defaultType)
  );
  const [previewTime, setPreviewTime] = useState(0);
  const [isSaving, setIsSaving] = useState(false);

  // Seed form state each time the dialog opens
  useEffect(() => {
    if (!open) return;
    if (caption) {
      setName(caption.name ?? '');
      setCaptionType(
        (Array.isArray(caption.captionType)
          ? caption.captionType[0]
          : caption.captionType) as CaptionType
      );
      setText(caption.text);
      setDuration(caption.duration || DEFAULT_DURATION);
      const existingCues = (caption.cues ?? []) as CaptionCue[];
      setCues(existingCues);
      setAnimated(existingCues.length > 0);
      setStyle({
        ...defaultStyleFor(
          (Array.isArray(caption.captionType)
            ? caption.captionType[0]
            : caption.captionType) as CaptionType
        ),
        ...((caption.style ?? {}) as CaptionStyle),
      });
    } else {
      setName('');
      setCaptionType(defaultType);
      setText('');
      setDuration(DEFAULT_DURATION);
      setCues([]);
      setAnimated(false);
      setStyle(defaultStyleFor(defaultType));
    }
    setPreviewTime(0);
  }, [open, caption, defaultType]);

  const handleTypeChange = useCallback((type: CaptionType) => {
    setCaptionType(type);
    setStyle(defaultStyleFor(type));
  }, []);

  const updateStyle = useCallback((patch: Partial<CaptionStyle>) => {
    setStyle((prev) => ({ ...prev, ...patch }));
  }, []);

  const updateCue = useCallback((index: number, patch: Partial<CaptionCue>) => {
    setCues((prev) =>
      prev.map((cue, i) => (i === index ? { ...cue, ...patch } : cue))
    );
  }, []);

  const addCue = useCallback(() => {
    setCues((prev) => {
      const lastEnd = prev.length > 0 ? prev[prev.length - 1].end : 0;
      return [
        ...prev,
        { text: '', start: lastEnd, end: Math.min(lastEnd + 2, duration) },
      ];
    });
  }, [duration]);

  const removeCue = useCallback((index: number) => {
    setCues((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const generateCuesFromText = useCallback(() => {
    const generated = splitTextIntoCues(text, duration);
    if (generated.length === 0) {
      toast.error('Add text first, one line per cue');
      return;
    }
    setCues(generated);
  }, [text, duration]);

  const validationError = useMemo(() => {
    if (!text.trim()) return 'Caption text is required';
    if (duration <= 0) return 'Duration must be greater than zero';
    if (animated) {
      for (let i = 0; i < cues.length; i++) {
        const cue = cues[i];
        if (!cue.text.trim()) return `Cue ${i + 1} has no text`;
        if (cue.end <= cue.start) return `Cue ${i + 1} ends before it starts`;
        if (cue.end > duration)
          return `Cue ${i + 1} extends past the caption duration`;
      }
    }
    return null;
  }, [text, duration, animated, cues]);

  const handleSave = useCallback(async () => {
    if (validationError) return;

    setIsSaving(true);
    try {
      const mutator = new CaptionMutator(pb);
      // Normalize line endings to bare LF so a stray CR from a CRLF textarea
      // (or pasted text) never reaches the renderer, where it draws as a tofu
      // box. Done at save time rather than on every keystroke to avoid
      // disturbing the textarea cursor/IME.
      const normalizedText = normalizeCaptionText(text);
      const normalizedCues =
        animated && cues.length > 0
          ? cues.map((cue) => ({
              ...cue,
              text: normalizeCaptionText(cue.text),
            }))
          : [];
      const input: CaptionInput = {
        WorkspaceRef: workspaceId,
        UserRef: pb.authStore.record?.id,
        name: name.trim() || undefined,
        captionType,
        text: normalizedText,
        cues: normalizedCues,
        duration,
        style,
      };

      const saved = caption
        ? await mutator.update(caption.id, {
            name: input.name ?? '',
            captionType: input.captionType,
            text: input.text,
            cues: input.cues,
            duration: input.duration,
            style: input.style,
          } as Partial<Caption>)
        : await mutator.create(input);

      await onSaved?.(saved);
      onOpenChange(false);
      toast.success(caption ? 'Caption updated' : 'Caption created');
    } catch (error) {
      console.error('Failed to save caption:', error);
      toast.error('Failed to save caption');
    } finally {
      setIsSaving(false);
    }
  }, [
    validationError,
    workspaceId,
    name,
    captionType,
    text,
    animated,
    cues,
    duration,
    style,
    caption,
    onSaved,
    onOpenChange,
  ]);

  const isTitle = captionType === CaptionType.TITLE;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEditing
              ? 'Edit Caption'
              : isTitle
                ? 'New Title Screen'
                : 'New Caption'}
          </DialogTitle>
          <DialogDescription>
            {isTitle
              ? 'Title screens show large text over the timeline background.'
              : 'Captions overlay text on your video and can change over time.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {/* Live preview */}
          <div className="relative aspect-video w-full bg-black rounded-md overflow-hidden border mx-auto max-h-[35vh] max-w-[calc(35vh*16/9)] lg:max-h-[45vh] lg:max-w-[calc(45vh*16/9)]">
            <CaptionOverlay
              text={text || 'Caption preview'}
              cues={animated ? cues : undefined}
              style={style}
              currentTime={previewTime}
            />
          </div>
          {animated && (
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground w-16 font-mono">
                {previewTime.toFixed(1)}s
              </span>
              <Slider
                value={[previewTime]}
                min={0}
                max={duration}
                step={0.1}
                onValueChange={([value]) => setPreviewTime(value)}
              />
            </div>
          )}

          {/* Type + name */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Type</Label>
              <ToggleGroup
                type="single"
                variant="outline"
                value={captionType}
                onValueChange={(value) => {
                  if (value) handleTypeChange(value as CaptionType);
                }}
                className="justify-start"
                disabled={isEditing}
              >
                <ToggleGroupItem value={CaptionType.CAPTION}>
                  Caption
                </ToggleGroupItem>
                <ToggleGroupItem value={CaptionType.TITLE}>
                  Title Screen
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="caption-name">Name (optional)</Label>
              <Input
                id="caption-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={isTitle ? 'Intro title' : 'Lower third'}
              />
            </div>
          </div>

          {/* Text */}
          <div className="grid gap-2">
            <Label htmlFor="caption-text">Text</Label>
            <Textarea
              id="caption-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                isTitle
                  ? 'My Awesome Video'
                  : 'Caption text…\nOne line per cue when animating'
              }
              rows={3}
            />
          </div>

          {/* Duration */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Duration (seconds)</Label>
              <TimeInput value={duration} onChange={setDuration} min={0.5} />
            </div>
            <div className="grid gap-2">
              <Label>Animate text</Label>
              <div className="flex items-center gap-2 h-9">
                <Switch checked={animated} onCheckedChange={setAnimated} />
                <span className="text-sm text-muted-foreground">
                  Change text over time
                </span>
              </div>
            </div>
          </div>

          {/* Cue editor */}
          {animated && (
            <div className="grid gap-2 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <Label>Cues</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={generateCuesFromText}
                  >
                    <WandSparkles className="h-4 w-4 mr-1" />
                    From text
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addCue}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add cue
                  </Button>
                </div>
              </div>
              {cues.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No cues yet. Generate them from your text (one line per cue)
                  or add them manually.
                </p>
              ) : (
                <div className="grid gap-2">
                  {cues.map((cue, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <TimeInput
                        value={cue.start}
                        onChange={(value) => updateCue(index, { start: value })}
                        min={0}
                        max={duration}
                        className="w-20"
                      />
                      <TimeInput
                        value={cue.end}
                        onChange={(value) => updateCue(index, { end: value })}
                        min={0}
                        max={duration}
                        className="w-20"
                      />
                      <Input
                        value={cue.text}
                        onChange={(e) =>
                          updateCue(index, { text: e.target.value })
                        }
                        placeholder="Cue text"
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeCue(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Style */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="caption-font-size">Font size</Label>
              <Input
                id="caption-font-size"
                type="number"
                min={8}
                max={400}
                value={style.fontSize ?? 48}
                onChange={(e) =>
                  updateStyle({ fontSize: Number(e.target.value) || 48 })
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="caption-color">Text color</Label>
              <Input
                id="caption-color"
                type="color"
                value={style.color ?? '#FFFFFF'}
                onChange={(e) => updateStyle({ color: e.target.value })}
                className="h-9 p-1"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="caption-bg">Background</Label>
              <div className="flex items-center gap-2">
                <Switch
                  checked={!!style.backgroundColor}
                  onCheckedChange={(checked) =>
                    updateStyle({
                      backgroundColor: checked ? '#000000' : undefined,
                    })
                  }
                />
                {style.backgroundColor && (
                  <Input
                    id="caption-bg"
                    type="color"
                    value={style.backgroundColor}
                    onChange={(e) =>
                      updateStyle({ backgroundColor: e.target.value })
                    }
                    className="h-9 w-12 p-1"
                  />
                )}
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Placement</Label>
              <div className="flex gap-1">
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={style.position ?? 'bottom'}
                  onValueChange={(value) => {
                    if (value)
                      updateStyle({
                        position: value as CaptionStyle['position'],
                      });
                  }}
                >
                  <ToggleGroupItem value="top" title="Top">
                    <ArrowUpToLine className="h-4 w-4" />
                  </ToggleGroupItem>
                  <ToggleGroupItem value="middle" title="Middle">
                    <FoldVertical className="h-4 w-4" />
                  </ToggleGroupItem>
                  <ToggleGroupItem value="bottom" title="Bottom">
                    <ArrowDownToLine className="h-4 w-4" />
                  </ToggleGroupItem>
                </ToggleGroup>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={style.align ?? 'center'}
                  onValueChange={(value) => {
                    if (value)
                      updateStyle({ align: value as CaptionStyle['align'] });
                  }}
                >
                  <ToggleGroupItem value="left" title="Align left">
                    <AlignLeft className="h-4 w-4" />
                  </ToggleGroupItem>
                  <ToggleGroupItem value="center" title="Align center">
                    <AlignCenter className="h-4 w-4" />
                  </ToggleGroupItem>
                  <ToggleGroupItem value="right" title="Align right">
                    <AlignRight className="h-4 w-4" />
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
            </div>
          </div>

          {validationError && (
            <p className="text-sm text-destructive">{validationError}</p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!!validationError || isSaving}>
            {isSaving
              ? 'Saving…'
              : isEditing
                ? 'Save Changes'
                : 'Add to Timeline'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
