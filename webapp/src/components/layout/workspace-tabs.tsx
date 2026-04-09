'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname, useParams } from 'next/navigation';
import { Upload, Film, Clapperboard } from 'lucide-react';
import { cn } from '@/lib/utils';

interface WorkspaceTabsProps {
  className?: string;
}

const tabs = [
  { label: 'Upload', segment: '/uploads', icon: Upload },
  { label: 'Media', segment: '/media', icon: Film },
  { label: 'Timelines', segment: '/timelines', icon: Clapperboard },
];

export function WorkspaceTabs({ className }: WorkspaceTabsProps) {
  const pathname = usePathname();
  const params = useParams();
  const workspaceId = params?.workspaceId as string | undefined;

  if (!workspaceId) return null;

  const wsPrefix = `/ws/${workspaceId}`;

  // Hide on timeline editor routes (/ws/[id]/timelines/[timelineId])
  const isTimelineEditor =
    /\/ws\/[^/]+\/timelines\/[^/]+/.test(pathname) &&
    !pathname.endsWith('/timelines');
  if (isTimelineEditor) return null;

  // Hide on secondary views (tasks, metrics) accessed via View menu
  const isSecondaryView =
    pathname.includes('/tasks') || pathname.includes('/metrics');
  if (isSecondaryView) return null;

  return (
    <div className={cn('border-b bg-background overflow-x-auto', className)}>
      <div className="container flex items-center h-10 gap-1 px-4">
        {tabs.map((tab) => {
          const href = `${wsPrefix}${tab.segment}`;
          const isActive = pathname.startsWith(href);
          const Icon = tab.icon;

          return (
            <Link
              key={tab.segment}
              href={href}
              className={cn(
                'relative flex items-center gap-1.5 px-3 h-10 text-sm font-medium transition-colors whitespace-nowrap',
                'hover:text-foreground',
                isActive ? 'text-foreground' : 'text-muted-foreground'
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
              {isActive && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
