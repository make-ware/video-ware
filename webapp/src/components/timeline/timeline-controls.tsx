'use client';

import React, { useState } from 'react';
import { useTimeline } from '@/hooks/use-timeline';
import { Button } from '@/components/ui/button';
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
import { Label } from '@/components/ui/label';
import { Film, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import type { OutputSettings } from '@/services/timeline';

interface TimelineControlsProps {
  className?: string;
}

export function TimelineControls({
  className: _className,
}: TimelineControlsProps) {
  const { timeline, createRenderTask, isLoading } = useTimeline();

  const [isRenderDialogOpen, setIsRenderDialogOpen] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [renderFormat, setRenderFormat] = useState('mp4');
  const [renderResolution, setRenderResolution] = useState('1920x1080');
  const [renderCodec, setRenderCodec] = useState('h264');

  const handleRenderClick = () => {
    if (!timeline) return;

    if (timeline.clips.length === 0) {
      toast.error('Cannot render an empty timeline', {
        description: 'Add clips first before rendering.',
      });
      return;
    }

    setIsRenderDialogOpen(true);
  };

  const handleConfirmRender = async () => {
    if (!timeline) return;

    const outputSettings: OutputSettings = {
      format: renderFormat,
      resolution: renderResolution,
      codec: renderCodec,
    };

    setIsRendering(true);
    try {
      await createRenderTask(outputSettings);
      setIsRenderDialogOpen(false);
      toast.success('Render task created successfully', {
        description: 'Check the tasks page for progress.',
      });
    } catch (error) {
      console.error('Failed to create render task:', error);
      toast.error('Failed to create render task', {
        description:
          error instanceof Error ? error.message : 'An unknown error occurred',
      });
    } finally {
      setIsRendering(false);
    }
  };

  if (!timeline) return null;

  return (
    <>
      {/* Render Button */}
      <Button
        onClick={handleRenderClick}
        disabled={isLoading || timeline.clips.length === 0}
        variant="secondary"
      >
        <Film className="h-4 w-4 mr-2" />
        Render
      </Button>

      {/* Render Settings Dialog */}
      <Dialog open={isRenderDialogOpen} onOpenChange={setIsRenderDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Render Timeline</DialogTitle>
            <DialogDescription>
              Configure output settings for rendering your timeline.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Format Selection */}
            <div className="space-y-2">
              <Label htmlFor="format">Output Format</Label>
              <Select value={renderFormat} onValueChange={setRenderFormat}>
                <SelectTrigger id="format">
                  <SelectValue placeholder="Select format" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mp4">MP4</SelectItem>
                  <SelectItem value="mov">MOV</SelectItem>
                  <SelectItem value="webm">WebM</SelectItem>
                  <SelectItem value="avi">AVI</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Resolution Selection */}
            <div className="space-y-2">
              <Label htmlFor="resolution">Resolution</Label>
              <Select
                value={renderResolution}
                onValueChange={setRenderResolution}
              >
                <SelectTrigger id="resolution">
                  <SelectValue placeholder="Select resolution" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="3840x2160">4K (3840x2160)</SelectItem>
                  <SelectItem value="1920x1080">Full HD (1920x1080)</SelectItem>
                  <SelectItem value="1280x720">HD (1280x720)</SelectItem>
                  <SelectItem value="854x480">SD (854x480)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Codec Selection */}
            <div className="space-y-2">
              <Label htmlFor="codec">Video Codec</Label>
              <Select value={renderCodec} onValueChange={setRenderCodec}>
                <SelectTrigger id="codec">
                  <SelectValue placeholder="Select codec" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="h264">H.264</SelectItem>
                  <SelectItem value="h265">H.265 (HEVC)</SelectItem>
                  <SelectItem value="vp9">VP9</SelectItem>
                  <SelectItem value="av1">AV1</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Info */}
            <div className="flex items-start gap-2 p-3 bg-muted rounded-lg text-sm">
              <AlertCircle className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
              <div className="text-muted-foreground">
                <p className="font-medium mb-1">Timeline Info</p>
                <p>Clips: {timeline.clips.length}</p>
                <p>Version: {timeline.version}</p>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsRenderDialogOpen(false)}
              disabled={isRendering}
            >
              Cancel
            </Button>
            <Button onClick={handleConfirmRender} disabled={isRendering}>
              {isRendering ? (
                <>
                  <div className="h-4 w-4 mr-2 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Creating Task...
                </>
              ) : (
                <>
                  <Film className="h-4 w-4 mr-2" />
                  Start Render
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
