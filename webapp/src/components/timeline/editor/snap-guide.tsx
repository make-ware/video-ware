'use client';

import React from 'react';
import { cn } from '@/lib/utils';

export interface SnapGuideProps {
    position: number; // pixels from left
    orientation: 'vertical';
    label?: string; // optional time label
}

export function SnapGuide({ position, orientation, label }: SnapGuideProps) {
    return (
        <div
            className={cn(
                'absolute pointer-events-none z-30',
                orientation === 'vertical' && 'top-0 bottom-0 w-[2px]'
            )}
            style={{ left: position }}
        >
            {/* Guide Line */}
            <div className="absolute inset-0 bg-yellow-400 shadow-[0_0_8px_rgba(250,204,21,0.6)] animate-pulse" />

            {/* Optional Label */}
            {label && (
                <div className="absolute top-2 left-2 bg-yellow-400 text-yellow-950 text-[10px] font-mono px-1.5 py-0.5 rounded shadow-md whitespace-nowrap">
                    {label}
                </div>
            )}
        </div>
    );
}
