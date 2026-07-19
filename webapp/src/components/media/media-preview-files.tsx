'use client';

import { useState } from 'react';
import {
  Media,
  MediaRelations,
  Expanded,
  File,
  FileStatus,
  MediaType,
} from '@project/shared';
import { normalizeMediaType } from './media-type-icon';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { MediaService } from '@/services/media';
import pb from '@/lib/pocketbase-client';

interface MediaPreviewFilesProps<
  E extends keyof MediaRelations = keyof MediaRelations,
> {
  media: Expanded<Media, MediaRelations, E>;
  onUpdate: () => void;
}

/**
 * Which preview assets are meaningful per media type. Video derives all five;
 * audio only an extracted audio track; images a thumbnail + sprite. A present
 * asset is always shown even if not in this list (e.g. embedded cover art).
 */
const ASSETS_BY_MEDIA_TYPE: Record<MediaType, string[]> = {
  [MediaType.VIDEO]: ['thumbnail', 'sprite', 'filmstrip', 'proxy', 'audio'],
  [MediaType.AUDIO]: ['audio'],
  [MediaType.IMAGE]: ['thumbnail', 'sprite'],
};

const ALL_ASSET_TYPES = ['thumbnail', 'sprite', 'filmstrip', 'proxy', 'audio'];

export function MediaPreviewFiles<
  E extends keyof MediaRelations = keyof MediaRelations,
>({ media, onUpdate }: MediaPreviewFilesProps<E>) {
  const [regenerating, setRegenerating] = useState<Record<string, boolean>>({});

  const expanded =
    'expand' in media && media.expand
      ? media.expand
      : ({} as Record<string, unknown>);
  const thumbnailFile =
    'thumbnailFileRef' in expanded
      ? (expanded.thumbnailFileRef as File | undefined)
      : undefined;
  const spriteFile =
    'spriteFileRef' in expanded
      ? (expanded.spriteFileRef as File | undefined)
      : undefined;
  const proxyFile =
    'proxyFileRef' in expanded
      ? (expanded.proxyFileRef as File | undefined)
      : undefined;
  const audioFile =
    'audioFileRef' in expanded
      ? (expanded.audioFileRef as File | undefined)
      : undefined;
  const filmstripFiles =
    'filmstripFileRefs' in expanded
      ? (expanded.filmstripFileRefs as File[]) || []
      : [];

  const handleRegenerate = async (type: string) => {
    try {
      setRegenerating((prev) => ({ ...prev, [type]: true }));
      const mediaService = new MediaService(pb);

      const config: {
        thumbnail?: boolean;
        sprite?: boolean;
        filmstrip?: boolean;
        transcode?: boolean;
        audio?: boolean;
      } = {};

      if (type === 'thumbnail') config.thumbnail = true;
      if (type === 'sprite') config.sprite = true;
      if (type === 'filmstrip') config.filmstrip = true;
      if (type === 'proxy') config.transcode = true;
      if (type === 'audio') config.audio = true;

      await mediaService.regeneratePreviews(media.id, config);

      toast.success(`Regeneration started for ${type}`);
      // We don't call onUpdate immediately because the task is just queued.
      // But we might want to refresh to show task status if we were tracking tasks.
      // For now, onUpdate simply refreshes the media details, which won't change yet.
      onUpdate();
    } catch (error) {
      console.error(`Failed to regenerate ${type}:`, error);
      toast.error(`Failed to regenerate ${type}`);
    } finally {
      setRegenerating((prev) => ({ ...prev, [type]: false }));
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const renderFileRow = (
    label: string,
    type: string,
    file?: File,
    files?: File[]
  ) => {
    const isPresent = !!file || (files && files.length > 0);
    const size = file
      ? file.size
      : files?.reduce((acc, f) => acc + f.size, 0) || 0;
    const status = file ? file.fileStatus : files?.[0]?.fileStatus || 'N/A';

    return (
      <TableRow key={type}>
        <TableCell className="font-medium">{label}</TableCell>
        <TableCell>
          {isPresent ? (
            <span
              className={
                status === FileStatus.AVAILABLE
                  ? 'text-green-600'
                  : 'text-yellow-600'
              }
            >
              {status}
            </span>
          ) : (
            <span className="text-muted-foreground">Missing</span>
          )}
        </TableCell>
        <TableCell>{isPresent ? formatSize(size) : '-'}</TableCell>
        <TableCell>
          {files && files.length > 0
            ? `${files.length} files`
            : file
              ? '1 file'
              : '-'}
        </TableCell>
        <TableCell className="text-right">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleRegenerate(type)}
            disabled={regenerating[type]}
          >
            <RefreshCw
              className={`h-4 w-4 mr-2 ${regenerating[type] ? 'animate-spin' : ''}`}
            />
            Regenerate
          </Button>
        </TableCell>
      </TableRow>
    );
  };

  const mediaType = normalizeMediaType(media.mediaType);
  const relevantAssets = new Set(
    mediaType ? ASSETS_BY_MEDIA_TYPE[mediaType] : ALL_ASSET_TYPES
  );

  const allRows: {
    label: string;
    type: string;
    file?: File;
    files?: File[];
  }[] = [
    { label: 'Thumbnail', type: 'thumbnail', file: thumbnailFile },
    { label: 'Sprite Sheet', type: 'sprite', file: spriteFile },
    { label: 'Filmstrip', type: 'filmstrip', files: filmstripFiles },
    { label: 'Proxy Video', type: 'proxy', file: proxyFile },
    { label: 'Audio Track', type: 'audio', file: audioFile },
  ];

  // Show a row if the asset is relevant to this media type, or if it exists
  // anyway (never hide an asset the user actually has).
  const visibleRows = allRows.filter((row) => {
    const present = !!row.file || (row.files?.length ?? 0) > 0;
    return present || relevantAssets.has(row.type);
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Preview Files</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Asset Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Size</TableHead>
              <TableHead>Count</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRows.map((row) =>
              renderFileRow(row.label, row.type, row.file, row.files)
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
