import React, { useState } from 'react';
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
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

interface RenderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RenderDialog({ open, onOpenChange }: RenderDialogProps) {
  const { createRenderTask, saveTimeline } = useTimeline();
  const [resolution, setResolution] = useState('1920x1080');
  const [includeCaptions, setIncludeCaptions] = useState(true);
  const [includeTransitions, setIncludeTransitions] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleRender = async () => {
    setIsSubmitting(true);
    try {
      await saveTimeline();
      await createRenderTask({
        resolution,
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
            <Label htmlFor="resolution" className="text-right">
              Resolution
            </Label>
            <div className="col-span-3">
              <Select value={resolution} onValueChange={setResolution}>
                <SelectTrigger id="resolution">
                  <SelectValue placeholder="Select resolution" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="3840x2160">4K (3840x2160)</SelectItem>
                  <SelectItem value="1920x1080">1080p (1920x1080)</SelectItem>
                  <SelectItem value="1280x720">720p (1280x720)</SelectItem>
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
              <Label htmlFor="captions" className="font-normal text-muted-foreground">
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
              <Label htmlFor="transitions" className="font-normal text-muted-foreground">
                Enable transitions
              </Label>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
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
