'use client';

import { useState } from 'react';
import { Media } from '@project/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Pencil, Save, X, Tag } from 'lucide-react';
import { toast } from 'sonner';
import pb from '@/lib/pocketbase-client';

interface MediaInfoEditorProps {
  media: Media;
  onUpdate: () => void;
}

/**
 * Displays and inline-edits the media's editor-facing label and description.
 * These are optional, searchable plain-text fields distinct from the source
 * upload's filename.
 */
export function MediaInfoEditor({ media, onUpdate }: MediaInfoEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [label, setLabel] = useState(media.label ?? '');
  const [description, setDescription] = useState(media.description ?? '');

  const startEditing = () => {
    setLabel(media.label ?? '');
    setDescription(media.description ?? '');
    setIsEditing(true);
  };

  const handleCancel = () => {
    setIsEditing(false);
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      await pb.collection('Media').update(media.id, {
        label: label.trim(),
        description: description.trim(),
      });
      toast.success('Media details updated');
      setIsEditing(false);
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
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-lg flex items-center gap-2">
          <Tag className="h-4 w-4 text-primary" />
          Label &amp; Description
        </CardTitle>
        {!isEditing && (
          <Button variant="outline" size="sm" onClick={startEditing}>
            <Pencil className="h-4 w-4 mr-2" />
            Edit
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {isEditing ? (
          <>
            <div className="space-y-2">
              <Label htmlFor="media-label">Label</Label>
              <Input
                id="media-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="A short, searchable name for this media"
                maxLength={200}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="media-description">Description</Label>
              <Textarea
                id="media-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Notes about this media (searchable)"
                rows={4}
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCancel}
                disabled={isSaving}
              >
                <X className="h-4 w-4 mr-2" />
                Cancel
              </Button>
              <Button size="sm" onClick={handleSave} disabled={isSaving}>
                <Save className="h-4 w-4 mr-2" />
                {isSaving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">
                Label
              </span>
              {media.label ? (
                <p className="text-sm font-medium">{media.label}</p>
              ) : (
                <p className="text-sm text-muted-foreground italic">
                  No label set
                </p>
              )}
            </div>
            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">
                Description
              </span>
              {media.description ? (
                <p className="text-sm whitespace-pre-wrap">
                  {media.description}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground italic">
                  No description set
                </p>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
