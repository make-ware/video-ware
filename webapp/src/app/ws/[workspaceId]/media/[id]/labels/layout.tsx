'use client';

import React from 'react';
import { LabelsNav } from './labels-nav';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';

export default function LabelsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const params = useParams();
  const workspaceId = params.workspaceId as string;
  const mediaId = params.id as string;

  return (
    // 2.5625rem = NavigationBar's fixed h-10 content + its border-b.
    <div className="container mx-auto py-6 h-[calc(100vh-2.5625rem)] flex flex-col">
      <div className="flex items-center justify-between mb-6 shrink-0">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push(`/ws/${workspaceId}/media/${mediaId}`)}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-3xl font-bold">Label Inspector</h1>
        </div>
      </div>
      <div className="shrink-0">
        <LabelsNav />
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}
