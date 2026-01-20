'use client';

import { useState } from 'react';
import { Media } from '@project/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Calendar as CalendarIcon, Save } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import pb from '@/lib/pocketbase-client';

interface MediaDetailsEditorProps {
  media: Media;
  onUpdate: () => void;
}

export function MediaDetailsEditor({
  media,
  onUpdate,
}: MediaDetailsEditorProps) {
  const [date, setDate] = useState<Date | undefined>(
    media.mediaDate ? new Date(media.mediaDate) : undefined
  );
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    try {
      setIsSaving(true);
      await pb.collection('Media').update(media.id, {
        mediaDate: date,
      });
      toast.success('Media details updated');
      onUpdate();
    } catch (error) {
      console.error('Failed to update media details:', error);
      toast.error('Failed to update media details');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Media Details</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Media Date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant={'outline'}
                  className={cn(
                    'w-full justify-start text-left font-normal',
                    !date && 'text-muted-foreground'
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {date ? format(date, 'PPP') : <span>Pick a date</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={date} onSelect={setDate} />
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-2">
            <Label>Duration</Label>
            <Input value={`${media.duration.toFixed(2)}s`} disabled />
          </div>

          <div className="space-y-2">
            <Label>Dimensions</Label>
            <Input value={`${media.width} x ${media.height}`} disabled />
          </div>

          <div className="space-y-2">
            <Label>Aspect Ratio</Label>
            <Input value={media.aspectRatio?.toFixed(2) || 'N/A'} disabled />
          </div>

          <div className="space-y-2">
            <Label>Media Type</Label>
            <Input value={media.mediaType} className="capitalize" disabled />
          </div>

          <div className="space-y-2">
            <Label>Created At</Label>
            <Input value={new Date(media.created).toLocaleString()} disabled />
          </div>
        </div>

        <div className="flex justify-end pt-4">
          <Button onClick={handleSave} disabled={isSaving}>
            <Save className="mr-2 h-4 w-4" />
            {isSaving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
