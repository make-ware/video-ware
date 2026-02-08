'use client';

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
    Edit,
    AlertCircle,
    Check,
    X,
    Clock,
    Layers,
    Info,
    Tag,
    FileVideo,
} from 'lucide-react';
import { VideoPlayerUI } from '@/components/video/video-player-ui';
import { TrimHandles } from '@/components/video/trim-handles';
import { SegmentEditor, type Segment } from '@/components/timeline/segment-editor';
import { useVideoSource } from '@/hooks/use-video-source';
import { MediaClipMutator } from '@project/shared/mutator';
import {
    calculateEffectiveDuration,
    validateTimeRange,
    ClipType,
} from '@project/shared';
import { calculateMediaDate, formatMediaDateTime } from '@/utils/date-utils';
import { ExpandedMedia, ExpandedMediaClip, ExpandedTimelineClip } from '@/types/expanded-types';
import pb from '@/lib/pocketbase-client';
import { toast } from 'sonner';

type ClipUnion = (ExpandedMediaClip | ExpandedTimelineClip) & {
    type: string;
    start: number;
    end: number;
    duration: number;
    id: string;
    clipData?: any;
    meta?: any;
};

interface ClipBaseDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    clip: ClipUnion;
    initialMode?: 'view' | 'edit';
    onSave?: (updates: any) => Promise<void>;
    onClipUpdated?: () => void;
}

const MIN_CLIP_DURATION = 0.5;

export function ClipBaseDialog({
    open,
    onOpenChange,
    clip,
    initialMode = 'view',
    onSave,
    onClipUpdated,
}: ClipBaseDialogProps) {
    const [mode, setMode] = useState<'view' | 'edit'>(initialMode);
    const [editStart, setEditStart] = useState(clip.start);
    const [editEnd, setEditEnd] = useState(clip.end);
    const [editSegments, setEditSegments] = useState<Segment[]>([]);
    const [isSaving, setIsSaving] = useState(false);
    const [currentVideoTime, setCurrentVideoTime] = useState<number>(0);
    const [validationError, setValidationError] = useState<string | null>(null);
    const videoRef = useRef<HTMLVideoElement>(null);

    const media = clip.expand?.MediaRef as ExpandedMedia | undefined;
    const isComposite = useMemo(() => {
        const segments = clip.clipData?.segments || clip.meta?.segments;
        return !!(segments && segments.length > 0) || clip.type === ClipType.COMPOSITE;
    }, [clip]);

    const { src, poster } = useVideoSource(media ?? undefined);

    useEffect(() => {
        if (open) {
            setMode(initialMode);
            setEditStart(clip.start);
            setEditEnd(clip.end);
            const segments = clip.clipData?.segments || clip.meta?.segments;
            if (isComposite && segments) {
                setEditSegments([...segments]);
            } else {
                setEditSegments([]);
            }
            setValidationError(null);
        }
    }, [open, clip, initialMode, isComposite]);

    useEffect(() => {
        if (!media || mode !== 'edit') return;

        if (isComposite) {
            if (editSegments.length === 0) {
                setValidationError('Composite clip must have at least one segment');
                return;
            }
            const dur = calculateEffectiveDuration(0, media.duration, editSegments);
            if (dur < MIN_CLIP_DURATION) {
                setValidationError(`Effective duration must be at least ${MIN_CLIP_DURATION}s`);
                return;
            }
        } else {
            if (!validateTimeRange(editStart, editEnd, media.duration)) {
                setValidationError('Invalid time range');
                return;
            }
            if (editEnd - editStart < MIN_CLIP_DURATION) {
                setValidationError(`Duration must be at least ${MIN_CLIP_DURATION}s`);
                return;
            }
        }
        setValidationError(null);
    }, [editStart, editEnd, editSegments, isComposite, media, mode]);

    useEffect(() => {
        const video = videoRef.current;
        if (!video || !open) return;
        const handleTimeUpdate = () => setCurrentVideoTime(video.currentTime);
        video.addEventListener('timeupdate', handleTimeUpdate);
        return () => video.removeEventListener('timeupdate', handleTimeUpdate);
    }, [open, mode]);

    const formatTime = (seconds: number) => {
        const min = Math.floor(seconds / 60);
        const sec = Math.floor(seconds % 60);
        const ms = Math.floor((seconds % 1) * 100);
        return `${min}:${sec.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
    };

    const handleTrimChange = useCallback((start: number, end: number) => {
        setEditStart(start);
        setEditEnd(end);
    }, []);

    const handleScrub = useCallback((time: number) => {
        if (videoRef.current) {
            try {
                videoRef.current.currentTime = time;
            } catch { }
        }
    }, []);

    const handleSaveInternal = async () => {
        if (validationError) return;
        setIsSaving(true);
        try {
            let updates: any = {};

            if (isComposite) {
                const newDuration = calculateEffectiveDuration(0, media?.duration || 0, editSegments);
                const starts = editSegments.map(s => s.start);
                const ends = editSegments.map(s => s.end);
                updates = {
                    start: Math.min(...starts),
                    end: Math.max(...ends),
                    duration: newDuration,
                };

                if ('clipData' in clip) {
                    updates.clipData = { ...clip.clipData, segments: editSegments };
                } else {
                    updates.meta = { ...clip.meta, segments: editSegments };
                }
            } else {
                updates = {
                    start: editStart,
                    end: editEnd,
                    duration: editEnd - editStart,
                };
            }

            if (onSave) {
                await onSave(updates);
            } else if ('clipData' in clip) {
                const mutator = new MediaClipMutator(pb);
                await mutator.update(clip.id, updates);
            } else {
                throw new Error('No save handler provided');
            }

            toast.success('Clip updated successfully');
            setMode('view');
            onClipUpdated?.();
            if (initialMode === 'edit') onOpenChange(false);
        } catch (err) {
            console.error('Failed to update clip:', err);
            toast.error('Failed to update clip');
        } finally {
            setIsSaving(false);
        }
    };

    const isEditable = useMemo(() => {
        return clip.type === ClipType.USER || clip.type === ClipType.COMPOSITE;
    }, [clip.type]);

    const metadata = useMemo(() => {
        return clip.clipData || clip.meta || {};
    }, [clip]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl" showCloseButton={false}>
                <DialogHeader>
                    <div className="flex items-center justify-between">
                        <DialogTitle className="flex items-center gap-2">
                            {mode === 'view' ? (
                                <><Info className="h-5 w-5 text-primary" /> Clip Details</>
                            ) : (
                                <><Edit className="h-5 w-5 text-primary" /> {isComposite ? 'Fine-Tune Segments' : 'Edit Time Range'}</>
                            )}
                        </DialogTitle>
                        <div className="flex items-center gap-2">
                            {mode === 'view' ? (
                                <>
                                    {isEditable && (
                                        <Button variant="outline" size="sm" onClick={() => setMode('edit')}>
                                            <Edit className="h-4 w-4 mr-1" /> Edit
                                        </Button>
                                    )}
                                    <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
                                        <X className="h-4 w-4" />
                                    </Button>
                                </>
                            ) : (
                                <>
                                    <Button variant="ghost" size="sm" onClick={() => initialMode === 'edit' ? onOpenChange(false) : setMode('view')} disabled={isSaving}>
                                        <X className="h-4 w-4 mr-1" /> Cancel
                                    </Button>
                                    <Button size="sm" onClick={handleSaveInternal} disabled={isSaving || !!validationError}>
                                        {isSaving ? 'Saving...' : <><Check className="h-4 w-4 mr-1" /> Save</>}
                                    </Button>
                                </>
                            )}
                        </div>
                    </div>
                </DialogHeader>

                <ScrollArea className="max-h-[85vh]">
                    <div className="space-y-6 p-1">
                        <div className="aspect-video bg-black rounded-lg overflow-hidden relative border shadow-sm">
                            {src ? (
                                <VideoPlayerUI
                                    src={src}
                                    poster={poster}
                                    startTime={mode === 'edit' ? (isComposite ? (editSegments[0]?.start || 0) : editStart) : clip.start}
                                    endTime={mode === 'edit' ? (isComposite ? (editSegments[editSegments.length - 1]?.end || media?.duration || 0) : editEnd) : clip.end}
                                    className="w-full h-full"
                                    ref={videoRef}
                                    autoPlay={mode === 'view'}
                                />
                            ) : (
                                <div className="flex items-center justify-center h-full text-muted-foreground">
                                    No preview available
                                </div>
                            )}
                            {mode === 'view' && (
                                <div className="absolute bottom-2 right-2 bg-black/70 text-white text-xs px-2 py-1 rounded font-mono">
                                    {formatTime(clip.start)} - {formatTime(clip.end)}
                                </div>
                            )}
                        </div>

                        {mode === 'edit' ? (
                            <div className="space-y-4">
                                {isComposite ? (
                                    <SegmentEditor
                                        segments={editSegments}
                                        mediaDuration={media?.duration || 0}
                                        onChange={setEditSegments}
                                    />
                                ) : (
                                    <div className="space-y-4">
                                        <TrimHandles
                                            duration={media?.duration || 0}
                                            startTime={editStart}
                                            endTime={editEnd}
                                            onChange={handleTrimChange}
                                            onScrub={handleScrub}
                                            currentTime={currentVideoTime}
                                            minDuration={MIN_CLIP_DURATION}
                                        />
                                        <div className="grid grid-cols-2 gap-4 bg-muted/30 p-4 rounded-lg">
                                            <div className="space-y-2">
                                                <Label>Start Time</Label>
                                                <Input
                                                    type="number"
                                                    step="0.01"
                                                    value={editStart.toFixed(2)}
                                                    onChange={(e) => setEditStart(parseFloat(e.target.value) || 0)}
                                                />
                                                <div className="text-xs font-mono text-muted-foreground">{formatTime(editStart)}</div>
                                            </div>
                                            <div className="space-y-2">
                                                <Label>End Time</Label>
                                                <Input
                                                    type="number"
                                                    step="0.01"
                                                    value={editEnd.toFixed(2)}
                                                    onChange={(e) => setEditEnd(parseFloat(e.target.value) || 0)}
                                                />
                                                <div className="text-xs font-mono text-muted-foreground">{formatTime(editEnd)}</div>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                                    <span className="text-sm font-medium flex items-center gap-2">
                                        {isComposite ? <Layers className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
                                        Effective Duration:
                                    </span>
                                    <span className="text-sm font-mono font-bold">
                                        {formatTime(isComposite ? calculateEffectiveDuration(0, media?.duration || 0, editSegments) : editEnd - editStart)}
                                    </span>
                                </div>

                                {validationError && (
                                    <Alert variant="destructive">
                                        <AlertCircle className="h-4 w-4" />
                                        <AlertDescription>{validationError}</AlertDescription>
                                    </Alert>
                                )}
                            </div>
                        ) : (
                            <>
                                <div className="grid grid-cols-2 gap-6">
                                    <div className="space-y-3">
                                        <h4 className="text-sm font-semibold flex items-center gap-2">
                                            <Clock className="h-4 w-4" /> Timing
                                        </h4>
                                        <div className="grid grid-cols-2 gap-2 text-sm">
                                            <div className="text-muted-foreground">Start:</div>
                                            <div className="font-mono text-right">{formatTime(clip.start)}</div>
                                            <div className="text-muted-foreground">End:</div>
                                            <div className="font-mono text-right">{formatTime(clip.end)}</div>
                                            <div className="text-muted-foreground font-medium">Duration:</div>
                                            <div className="font-mono text-right font-medium">
                                                {isComposite ? formatTime(clip.duration) : formatTime(clip.end - clip.start)}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="space-y-3">
                                        <h4 className="text-sm font-semibold flex items-center gap-2">
                                            <FileVideo className="h-4 w-4" /> Source Media
                                        </h4>
                                        <div className="space-y-2 text-sm">
                                            <div className="grid grid-cols-[auto,1fr] gap-2">
                                                <span className="text-muted-foreground">Date:</span>
                                                <span className="font-medium text-foreground">
                                                    {media ? formatMediaDateTime(calculateMediaDate(media.mediaDate, clip.start)) : 'N/A'}
                                                </span>
                                            </div>
                                            <div className="grid grid-cols-[auto,1fr] gap-2">
                                                <span className="text-muted-foreground">Type:</span>
                                                <span className="capitalize">{media?.mediaType || 'N/A'}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <Separator />

                                <div className="space-y-3">
                                    <h4 className="text-sm font-semibold flex items-center gap-2">
                                        <Tag className="h-4 w-4" /> Metadata
                                    </h4>
                                    <div className="space-y-2">
                                        {Object.keys(metadata).length > 0 ? (
                                            <div className="bg-muted/50 p-3 rounded-md text-xs font-mono whitespace-pre-wrap">
                                                {JSON.stringify(metadata, null, 2)}
                                            </div>
                                        ) : (
                                            <p className="text-sm text-muted-foreground italic">
                                                No additional metadata available.
                                            </p>
                                        )}
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </ScrollArea>
            </DialogContent>
        </Dialog>
    );
}
