'use client';

import { useState } from 'react';
import { Media, MediaType } from '@project/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Calendar as CalendarIcon, Save, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import pb from '@/lib/pocketbase-client';

const ROTATION_OPTIONS = [0, 90, 180, 270] as const;

function formatBitrate(bps?: number): string {
  if (!bps || bps <= 0) return 'N/A';
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(2)} Mbps`;
  return `${Math.round(bps / 1000)} kbps`;
}

function formatSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return 'N/A';
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${Math.round(bytes / 1000)} KB`;
}

function ReadonlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input value={value} disabled />
    </div>
  );
}

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
  const [label, setLabel] = useState(media.label ?? '');
  const [description, setDescription] = useState(media.description ?? '');
  const [rotation, setRotation] = useState<number>(media.rotation ?? 0);
  const [isSaving, setIsSaving] = useState(false);
  const [showTechnical, setShowTechnical] = useState(false);

  // Media type drives which fields make sense. The nested video/audio probe
  // objects are absent for non-video media, so guard on their presence rather
  // than assuming they exist (this was the source of the details-page crash).
  const isAudio = media.mediaType === MediaType.AUDIO;
  const isImage = media.mediaType === MediaType.IMAGE;
  const videoMeta = media.mediaData.video;
  const audioMeta = media.mediaData.audio;

  const handleSave = async () => {
    try {
      setIsSaving(true);
      await pb.collection('Media').update(media.id, {
        mediaDate: date,
        label: label.trim(),
        description: description.trim(),
        rotation,
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
        <div className="space-y-2">
          <Label htmlFor="media-details-label">Label</Label>
          <Input
            id="media-details-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="A short, searchable name for this media"
            maxLength={200}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="media-details-description">Description</Label>
          <Textarea
            id="media-details-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Notes about this media (searchable)"
            rows={4}
          />
        </div>

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

          {!isImage && (
            <div className="space-y-2">
              <Label>Duration</Label>
              <Input value={`${media.duration.toFixed(2)}s`} disabled />
            </div>
          )}

          {!isAudio && (
            <div className="space-y-2">
              <Label>Dimensions</Label>
              <Input value={`${media.width} x ${media.height}`} disabled />
            </div>
          )}

          {!isAudio && (
            <div className="space-y-2">
              <Label>Aspect Ratio</Label>
              <Input value={media.aspectRatio?.toFixed(2) || 'N/A'} disabled />
            </div>
          )}

          <div className="space-y-2">
            <Label>Media Type</Label>
            <Input value={media.mediaType} className="capitalize" disabled />
          </div>

          {!isAudio && (
            <div className="space-y-2">
              <Label htmlFor="media-details-rotation">Rotation</Label>
              <Select
                value={String(rotation)}
                onValueChange={(v) => setRotation(Number(v))}
              >
                <SelectTrigger id="media-details-rotation" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROTATION_OPTIONS.map((deg) => (
                    <SelectItem key={deg} value={String(deg)}>
                      {deg}°
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {!isImage && (
            <ReadonlyField
              label="Has Audio"
              value={media.hasAudio ? 'Yes' : 'No'}
            />
          )}

          <ReadonlyField
            label="Created At"
            value={new Date(media.created).toLocaleString()}
          />
        </div>

        <Collapsible open={showTechnical} onOpenChange={setShowTechnical}>
          <CollapsibleTrigger className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
            <ChevronRight
              className={cn(
                'h-4 w-4 transition-transform',
                showTechnical && 'rotate-90'
              )}
            />
            Technical Info
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <ReadonlyField label="Container" value={media.mediaData.format} />
              <ReadonlyField
                label="File Size"
                value={formatSize(media.mediaData.size)}
              />
              {!isImage && !isAudio && (
                <ReadonlyField
                  label="Frame Rate"
                  value={`${media.mediaData.fps} fps`}
                />
              )}
              <ReadonlyField
                label="Overall Bitrate"
                value={formatBitrate(media.mediaData.bitrate)}
              />
              {videoMeta && (
                <>
                  <ReadonlyField
                    label="Video Codec"
                    value={videoMeta.codec || 'N/A'}
                  />
                  <ReadonlyField
                    label="Video Profile"
                    value={
                      [videoMeta.profile, videoMeta.level]
                        .filter(Boolean)
                        .join(' / ') || 'N/A'
                    }
                  />
                  <ReadonlyField
                    label="Pixel Format"
                    value={videoMeta.pixFmt || 'N/A'}
                  />
                  <ReadonlyField
                    label="Color Space"
                    value={videoMeta.colorSpace || 'N/A'}
                  />
                </>
              )}
              {audioMeta && (
                <>
                  <ReadonlyField
                    label="Audio Codec"
                    value={audioMeta.codec || 'N/A'}
                  />
                  <ReadonlyField
                    label="Audio Bitrate"
                    value={formatBitrate(audioMeta.bitrate)}
                  />
                  <ReadonlyField
                    label="Audio Channels"
                    value={
                      audioMeta.channels ? String(audioMeta.channels) : 'N/A'
                    }
                  />
                  <ReadonlyField
                    label="Sample Rate"
                    value={
                      audioMeta.sampleRate
                        ? `${audioMeta.sampleRate} Hz`
                        : 'N/A'
                    }
                  />
                </>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>

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
