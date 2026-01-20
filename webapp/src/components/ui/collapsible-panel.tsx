'use client';

import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import {
  ChevronLeft,
  ChevronRight,
  PanelLeftClose,
  PanelRightClose,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

interface CollapsiblePanelProps {
  children: React.ReactNode;
  side: 'left' | 'right';
  initiallyCollapsed?: boolean;
  className?: string;
  width?: string;
  title?: string;
}

export function CollapsiblePanel({
  children,
  side,
  initiallyCollapsed = false,
  className,
  width = 'w-64',
  title,
}: CollapsiblePanelProps) {
  const [isCollapsed, setIsCollapsed] = useState(initiallyCollapsed);

  const toggle = () => setIsCollapsed(!isCollapsed);

  const Icon =
    side === 'left'
      ? isCollapsed
        ? ChevronRight
        : PanelLeftClose
      : isCollapsed
        ? ChevronLeft
        : PanelRightClose;

  return (
    <div
      className={cn(
        'relative bg-background border-muted flex flex-col transition-all duration-300 ease-in-out h-full',
        side === 'left' ? 'border-r' : 'border-l',
        isCollapsed ? 'w-12' : width,
        className
      )}
    >
      <div
        className={cn(
          'flex items-center p-2 border-b border-muted min-h-[48px]',
          isCollapsed ? 'justify-center' : 'justify-between'
        )}
      >
        {!isCollapsed && title && (
          <h3 className="font-semibold text-sm truncate">{title}</h3>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggle}
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          title={isCollapsed ? 'Expand' : 'Collapse'}
        >
          <Icon className="h-4 w-4" />
        </Button>
      </div>

      <div
        className={cn(
          'flex-1 overflow-hidden transition-opacity duration-300',
          isCollapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'
        )}
      >
        {children}
      </div>

      {isCollapsed && (
        <div className="absolute inset-y-0 right-0 left-0 flex items-center justify-center pointer-events-none pb-12">
          {title && (
            <span className="[writing-mode:vertical-lr] text-[10px] font-medium text-muted-foreground/60 uppercase tracking-widest rotate-180">
              {title}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
