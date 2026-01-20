'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { Clock, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ClipBoxProps {
  id: string;
  name: string;
  duration: number;
  isSelected?: boolean;
  onSelect?: () => void;
  onEdit?: (e: React.MouseEvent) => void;
  className?: string;
  color?: string;
}

export function ClipBox({
  id: _id,
  name,
  duration,
  isSelected,
  onSelect,
  onEdit,
  className,
  color = 'bg-blue-500',
}: ClipBoxProps) {
  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div
      onClick={onSelect}
      className={cn(
        'relative h-full min-w-[40px] rounded-md border-2 transition-all cursor-pointer group flex flex-col justify-center px-2 overflow-hidden',
        color,
        isSelected
          ? 'border-white ring-2 ring-primary ring-offset-2'
          : 'border-transparent hover:border-white/50',
        className
      )}
    >
      <div className="flex items-center gap-1.5 overflow-hidden">
        <span className="text-xs font-bold text-white truncate drop-shadow-sm">
          {name}
        </span>
      </div>
      <div className="flex items-center gap-1 text-[10px] text-white/90 drop-shadow-sm">
        <Clock className="w-2.5 h-2.5" />
        <span>{formatDuration(duration)}s</span>
      </div>

      {/* Edit Button - show on hover/selection */}
      {onEdit && (
        <Button
          variant="secondary"
          size="icon"
          className={cn(
            'absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity',
            isSelected && 'opacity-100'
          )}
          onClick={(e) => {
            e.stopPropagation();
            onEdit(e);
          }}
        >
          <Pencil className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}
