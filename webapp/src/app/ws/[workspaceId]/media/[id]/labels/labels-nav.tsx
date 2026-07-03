'use client';

import Link from 'next/link';
import { usePathname, useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { INSPECTOR_CONFIGS } from '@/components/labels/inspector/config';

export function LabelsNav() {
  const pathname = usePathname();
  const params = useParams();
  const workspaceId = params.workspaceId as string;
  const mediaId = params.id as string;

  const base = `/ws/${workspaceId}/media/${mediaId}/labels`;
  const tabs = [
    ...INSPECTOR_CONFIGS.map((config) => ({
      name: config.title,
      href: `${base}/${config.key}`,
    })),
    { name: 'Transcripts', href: `${base}/transcripts` },
  ];

  return (
    <div className="flex items-center space-x-2 border-b mb-6 overflow-x-auto">
      {tabs.map((tab) => {
        const isActive = pathname.startsWith(tab.href);
        return (
          <Link key={tab.href} href={tab.href}>
            <Button
              variant={isActive ? 'default' : 'ghost'}
              className="rounded-b-none"
            >
              {tab.name}
            </Button>
          </Link>
        );
      })}
    </div>
  );
}
