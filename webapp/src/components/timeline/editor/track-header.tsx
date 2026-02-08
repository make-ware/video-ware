'use client';

import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import type { TimelineTrackRecord } from '@project/shared';
import { Volume2, VolumeX, Lock, Unlock, Trash2, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';

export interface TrackHeaderProps {
    track: TimelineTrackRecord;
    isSelected: boolean;
    onSelect: () => void;
    onRename: (name: string) => void;
    onToggleMute: () => void;
    onToggleLock: () => void;
    onVolumeChange: (volume: number) => void;
    onOpacityChange: (opacity: number) => void;
    onDelete: () => void;
}

export function TrackHeader({
    track,
    isSelected,
    onSelect,
    onRename,
    onToggleMute,
    onToggleLock,
    onVolumeChange,
    onOpacityChange,
    onDelete,
}: TrackHeaderProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [editName, setEditName] = useState(track.name || `Track ${track.layer}`);
    const [showControls, setShowControls] = useState(false);

    const handleNameSubmit = () => {
        setIsEditing(false);
        if (editName.trim() && editName !== track.name) {
            onRename(editName.trim());
        } else {
            setEditName(track.name || `Track ${track.layer}`);
        }
    };

    const handleNameKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleNameSubmit();
        } else if (e.key === 'Escape') {
            setIsEditing(false);
            setEditName(track.name || `Track ${track.layer}`);
        }
    };

    return (
        <div
            className={cn(
                'flex flex-col border-r bg-muted/30 transition-colors',
                isSelected && 'bg-muted/50 border-primary/50'
            )}
            onClick={onSelect}
        >
            {/* Main Header Area */}
            <div className="flex items-center gap-2 p-2 min-h-[64px]">
                {/* Layer Badge */}
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-bold">
                                {track.layer}
                            </div>
                        </TooltipTrigger>
                        <TooltipContent>
                            <p>Layer {track.layer}</p>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>

                {/* Track Name */}
                <div className="flex-1 min-w-0">
                    {isEditing ? (
                        <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onBlur={handleNameSubmit}
                            onKeyDown={handleNameKeyDown}
                            className="w-full px-2 py-1 text-sm bg-background border rounded focus:outline-none focus:ring-2 focus:ring-primary"
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                        />
                    ) : (
                        <div
                            className="text-sm font-medium truncate cursor-text hover:text-primary transition-colors"
                            onDoubleClick={(e) => {
                                e.stopPropagation();
                                setIsEditing(true);
                            }}
                            title={track.name || `Track ${track.layer}`}
                        >
                            {track.name || `Track ${track.layer}`}
                        </div>
                    )}
                </div>

                {/* Quick Controls */}
                <div className="flex items-center gap-1">
                    {/* Mute Toggle */}
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className={cn(
                                        'h-7 w-7',
                                        track.isMuted && 'text-destructive hover:text-destructive'
                                    )}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onToggleMute();
                                    }}
                                >
                                    {track.isMuted ? (
                                        <VolumeX className="h-4 w-4" />
                                    ) : (
                                        <Volume2 className="h-4 w-4" />
                                    )}
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                                <p>{track.isMuted ? 'Unmute' : 'Mute'} Track</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>

                    {/* Lock Toggle */}
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className={cn(
                                        'h-7 w-7',
                                        track.isLocked && 'text-warning hover:text-warning'
                                    )}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onToggleLock();
                                    }}
                                >
                                    {track.isLocked ? (
                                        <Lock className="h-4 w-4" />
                                    ) : (
                                        <Unlock className="h-4 w-4" />
                                    )}
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                                <p>{track.isLocked ? 'Unlock' : 'Lock'} Track</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>

                    {/* Expand Controls Toggle */}
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setShowControls(!showControls);
                                    }}
                                >
                                    {showControls ? (
                                        <EyeOff className="h-4 w-4" />
                                    ) : (
                                        <Eye className="h-4 w-4" />
                                    )}
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                                <p>{showControls ? 'Hide' : 'Show'} Controls</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
            </div>

            {/* Expanded Controls */}
            {showControls && (
                <div className="px-3 pb-3 space-y-3 border-t bg-muted/20">
                    {/* Volume Slider */}
                    <div className="space-y-1">
                        <div className="flex items-center justify-between">
                            <label className="text-xs text-muted-foreground">Volume</label>
                            <span className="text-xs font-mono">
                                {Math.round(track.volume * 100)}%
                            </span>
                        </div>
                        <Slider
                            value={[track.volume]}
                            min={0}
                            max={1}
                            step={0.01}
                            onValueChange={([value]) => onVolumeChange(value)}
                            className="w-full"
                            disabled={track.isMuted}
                        />
                    </div>

                    {/* Opacity Slider */}
                    <div className="space-y-1">
                        <div className="flex items-center justify-between">
                            <label className="text-xs text-muted-foreground">Opacity</label>
                            <span className="text-xs font-mono">
                                {Math.round(track.opacity * 100)}%
                            </span>
                        </div>
                        <Slider
                            value={[track.opacity]}
                            min={0}
                            max={1}
                            step={0.01}
                            onValueChange={([value]) => onOpacityChange(value)}
                            className="w-full"
                        />
                    </div>

                    {/* Delete Button */}
                    <Button
                        variant="destructive"
                        size="sm"
                        className="w-full"
                        onClick={(e) => {
                            e.stopPropagation();
                            onDelete();
                        }}
                    >
                        <Trash2 className="h-3 w-3 mr-2" />
                        Delete Track
                    </Button>
                </div>
            )}
        </div>
    );
}
