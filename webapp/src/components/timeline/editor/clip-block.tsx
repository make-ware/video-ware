'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import type { TimelineClip, MediaClip } from '@project/shared';
import { CompositeClipOverlay } from './composite-clip-overlay';

export interface ClipBlockProps {
    clip: TimelineClip;
    left: number;
    width: number;
    isSelected: boolean;
    isLocked: boolean;
    onSelect: () => void;
    onResizeStart: (
        handle: 'left' | 'right',
        e: React.MouseEvent | React.TouchEvent
    ) => void;
    onDragStart: (e: React.DragEvent) => void;
}

export function ClipBlock({
    clip,
    left,
    width,
    isSelected,
    isLocked,
    onSelect,
    onResizeStart,
    onDragStart,
}: ClipBlockProps) {
    const clipDuration = clip.end - clip.start;
    const clipColor =
        clip.meta?.color || (isSelected ? 'bg-primary' : 'bg-blue-600/60');

    // Extract composite clip data
    const mediaClip = (
        clip as TimelineClip & { expand?: { MediaClipRef?: MediaClip } }
    ).expand?.MediaClipRef;
    const clipData = mediaClip?.clipData as
        | { segments?: Array<{ start: number; end: number }> }
        | undefined;
    const segments = clipData?.segments;
    const isComposite =
        mediaClip?.type === 'composite' && segments && segments.length > 0;

    return (
        <div
            className={cn(
                'absolute top-0 bottom-0 border-r border-background/20 transition-all group cursor-pointer',
                clipColor,
                isSelected && 'ring-2 ring-inset ring-white/50 z-10 shadow-sm',
                isLocked && 'cursor-not-allowed opacity-60'
            )}
            style={{ left, width }}
            onClick={(e) => {
                e.stopPropagation();
                if (!isLocked) {
                    onSelect();
                }
            }}
            draggable={!isLocked}
            onDragStart={(e) => {
                if (!isLocked) {
                    onDragStart(e);
                }
            }}
        >
            {/* Resize Handles - only show when selected and not locked */}
            {isSelected && !isLocked && (
                <>
                    {/* Left Handle */}
                    <div
                        className="absolute left-0 top-0 bottom-0 w-6 -left-3 cursor-ew-resize flex items-center justify-center z-20 group/handle"
                        onMouseDown={(e) => onResizeStart('left', e)}
                        onTouchStart={(e) => onResizeStart('left', e)}
                    >
                        <div className="w-1.5 h-8 bg-white shadow-sm rounded-full group-hover/handle:scale-110 transition-transform" />
                    </div>

                    {/* Right Handle */}
                    <div
                        className="absolute right-0 top-0 bottom-0 w-6 -right-3 cursor-ew-resize flex items-center justify-center z-20 group/handle"
                        onMouseDown={(e) => onResizeStart('right', e)}
                        onTouchStart={(e) => onResizeStart('right', e)}
                    >
                        <div className="w-1.5 h-8 bg-white shadow-sm rounded-full group-hover/handle:scale-110 transition-transform" />
                    </div>

                    {/* Duration Label */}
                    <div className="absolute top-1 left-4 text-[10px] text-white font-mono pointer-events-none truncate pr-4 drop-shadow-md">
                        {Math.round(clipDuration * 10) / 10}s
                    </div>
                </>
            )}

            {/* Composite Clip Overlay - show segment visualization */}
            {isComposite && (
                <CompositeClipOverlay
                    segments={segments!}
                    clipStart={clip.start}
                    clipEnd={clip.end}
                    showBadge={true}
                />
            )}
        </div>
    );
}
