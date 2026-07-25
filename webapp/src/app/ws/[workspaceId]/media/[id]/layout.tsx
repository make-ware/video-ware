'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import { useWorkspace } from '@/hooks/use-workspace';
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
    <>
      {currentWorkspace && id && <MediaNavigationPanel currentMediaId={id} />}
      {children}
    </>
  );
}
