'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import { useWorkspace } from '@/hooks/use-workspace';
import { MediaProvider } from '@/contexts/media-context';
import { MediaNavigationPanel } from '@/components/media/media-navigation-panel';

export default function MediaDetailLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { currentWorkspace } = useWorkspace();
  const params = useParams();
  const id = params?.id as string;

  return (
    <MediaProvider workspaceId={currentWorkspace?.id || ''}>
      {currentWorkspace && id && <MediaNavigationPanel currentMediaId={id} />}
      {children}
    </MediaProvider>
  );
}
