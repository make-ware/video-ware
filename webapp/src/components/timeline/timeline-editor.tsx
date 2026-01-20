'use client';

import React from 'react';
import { useTimeline } from '@/hooks/use-timeline';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Film, Clock, AlertCircle, Save, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TimelineTrack } from './timeline-track';
import { TimelineControls } from './timeline-controls';

interface TimelineEditorProps {
  className?: string;
}

export function TimelineEditor({ className }: TimelineEditorProps) {
  const { timeline, isLoading, error, hasUnsavedChanges, saveTimeline } =
    useTimeline();
  const [isSaving, setIsSaving] = React.useState(false);

  const formatDuration = (seconds: number): string => {
    if (seconds === 0) return '0:00';

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  const calculateTotalDuration = (): number => {
    if (!timeline) return 0;
    return timeline.clips.reduce(
      (sum, clip) => sum + (clip.end - clip.start),
      0
    );
  };

  const handleSave = async () => {
    if (!timeline) return;

    setIsSaving(true);
    try {
      await saveTimeline();
    } catch (error) {
      console.error('Failed to save timeline:', error);
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading && !timeline) {
    return (
      <div className={cn('space-y-4', className)}>
        <Card>
          <CardContent className="p-6">
            <Skeleton className="h-32 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive" className={className}>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (!timeline) {
    return (
      <Alert className={className}>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>Timeline not found</AlertDescription>
      </Alert>
    );
  }

  const totalDuration = calculateTotalDuration();

  return (
    <div className={cn('space-y-4', className)}>
      {/* Timeline Track Card - First */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Timeline Editor</h3>

            {/* Save Button */}
            <Button
              onClick={handleSave}
              disabled={!hasUnsavedChanges || isSaving || isLoading}
              variant={hasUnsavedChanges ? 'default' : 'outline'}
              size="sm"
            >
              {isSaving ? (
                <>
                  <div className="h-3 w-3 mr-2 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Saving...
                </>
              ) : hasUnsavedChanges ? (
                <>
                  <Save className="h-3 w-3 mr-2" />
                  Save
                </>
              ) : (
                <>
                  <Check className="h-3 w-3 mr-2" />
                  Saved
                </>
              )}
            </Button>
          </div>
        </CardHeader>

        <CardContent className="pt-0">
          <TimelineTrack />
        </CardContent>
      </Card>

      {/* Timeline Header Card - Below Track */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Film className="h-6 w-6 text-primary" />
              <div>
                <h2 className="text-2xl font-semibold">{timeline.name}</h2>
                <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    <span>{formatDuration(totalDuration)}</span>
                  </div>
                  <div>
                    {timeline.clips.length}{' '}
                    {timeline.clips.length === 1 ? 'clip' : 'clips'}
                  </div>
                  <div>Version {timeline.version}</div>
                  {hasUnsavedChanges && (
                    <div className="text-amber-600 dark:text-amber-400 font-medium">
                      • Unsaved changes
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Save and Render Buttons */}
            <div className="flex items-center gap-2">
              <Button
                onClick={handleSave}
                disabled={!hasUnsavedChanges || isSaving || isLoading}
                variant={hasUnsavedChanges ? 'default' : 'outline'}
              >
                {isSaving ? (
                  <>
                    <div className="h-4 w-4 mr-2 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    Saving...
                  </>
                ) : hasUnsavedChanges ? (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    Save
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4 mr-2" />
                    Saved
                  </>
                )}
              </Button>

              <TimelineControls />
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Empty State */}
      {timeline.clips.length === 0 && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            This timeline has no clips yet. Add clips from the clip browser
            below to start building your sequence.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
