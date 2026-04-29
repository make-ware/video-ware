import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useTimeline } from '@/hooks/use-timeline';
import { TimelineOrientation } from '@project/shared';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

const RESOLUTIONS: Record<
  TimelineOrientation,
  ReadonlyArray<{ value: string; label: string }>
> = {
  [TimelineOrientation.LANDSCAPE]: [
    { value: '3840x2160', label: '4K (3840x2160)' },
    { value: '1920x1080', label: '1080p (1920x1080)' },
    { value: '1280x720', label: '720p (1280x720)' },
  ],
  [TimelineOrientation.PORTRAIT]: [
    { value: '2160x3840', label: '4K (2160x3840)' },
    { value: '1080x1920', label: '1080p (1080x1920)' },
    { value: '720x1280', label: '720p (720x1280)' },
  ],
};

// Maps a resolution to its tier index so a user picking 1080p stays at the
// same tier when toggling orientation.
function findTierIndex(
  orientation: TimelineOrientation,
  value: string
): number {
  const idx = RESOLUTIONS[orientation].findIndex((r) => r.value === value);
  return idx === -1 ? 1 : idx; // default to 1080p (index 1) if unknown
}

interface RenderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RenderDialog({ open, onOpenChange }: RenderDialogProps) {
  const { timeline, createRenderTask, saveTimeline } = useTimeline();
  const initialOrientation: TimelineOrientation =
    timeline?.orientation === TimelineOrientation.PORTRAIT
      ? TimelineOrientation.PORTRAIT
      : TimelineOrientation.LANDSCAPE;
  const [orientation, setOrientation] =
    useState<TimelineOrientation>(initialOrientation);
  const [resolution, setResolution] = useState(
    RESOLUTIONS[initialOrientation][1].value
  );
  const [includeCaptions, setIncludeCaptions] = useState(true);
  const [includeTransitions, setIncludeTransitions] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // When the dialog opens (or timeline orientation changes), reset to the
  // timeline's stored orientation so users see a sensible default.
  useEffect(() => {
    if (!open) return;
    const next: TimelineOrientation =
      timeline?.orientation === TimelineOrientation.PORTRAIT
        ? TimelineOrientation.PORTRAIT
        : TimelineOrientation.LANDSCAPE;
    setOrientation(next);
    setResolution(RESOLUTIONS[next][1].value);
  }, [open, timeline?.orientation]);

  const handleOrientationChange = (next: TimelineOrientation) => {
    const tier = findTierIndex(orientation, resolution);
    setOrientation(next);
    setResolution(RESOLUTIONS[next][tier].value);
  };

  const handleRender = async () => {
    setIsSubmitting(true);
    try {
      await saveTimeline();
      await createRenderTask({
        resolution,
        orientation,
        codec: 'libx264',
        format: 'mp4',
        includeCaptions,
        includeTransitions,
      });
      toast.success('Render task created! Check Renders for progress.');
      onOpenChange(false);
    } catch (err) {
      toast.error(`Failed to start render: ${(err as Error).message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Render Timeline</DialogTitle>
          <DialogDescription>
            Configure output settings for your video.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="orientation" className="text-right">
              Orientation
            </Label>
            <div className="col-span-3">
              <Select
                value={orientation}
                onValueChange={(v) =>
                  handleOrientationChange(v as TimelineOrientation)
                }
              >
                <SelectTrigger id="orientation">
                  <SelectValue placeholder="Select orientation" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={TimelineOrientation.LANDSCAPE}>
                    Landscape (16:9)
                  </SelectItem>
                  <SelectItem value={TimelineOrientation.PORTRAIT}>
                    Portrait (9:16)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="resolution" className="text-right">
              Resolution
            </Label>
            <div className="col-span-3">
              <Select value={resolution} onValueChange={setResolution}>
                <SelectTrigger id="resolution">
                  <SelectValue placeholder="Select resolution" />
                </SelectTrigger>
                <SelectContent>
                  {RESOLUTIONS[orientation].map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="captions" className="text-right">
              Captions
            </Label>
            <div className="col-span-3 flex items-center space-x-2">
              <Switch
                id="captions"
                checked={includeCaptions}
                onCheckedChange={setIncludeCaptions}
              />
              <Label
                htmlFor="captions"
                className="font-normal text-muted-foreground"
              >
                Include text tracks
              </Label>
            </div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="transitions" className="text-right">
              Transitions
            </Label>
            <div className="col-span-3 flex items-center space-x-2">
              <Switch
                id="transitions"
                checked={includeTransitions}
                onCheckedChange={setIncludeTransitions}
              />
              <Label
                htmlFor="transitions"
                className="font-normal text-muted-foreground"
              >
                Enable transitions
              </Label>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button onClick={handleRender} disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Render Video
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
