'use client';

import Link from 'next/link';
import { usePathname, useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';

export function LabelsNav() {
  const pathname = usePathname();
  const params = useParams();
  const workspaceId = params.workspaceId as string;
  const mediaId = params.id as string;

  const tabs = [
    {
      name: 'Objects',
      href: `/ws/${workspaceId}/media/${mediaId}/labels/objects`,
    },
    { name: 'Faces', href: `/ws/${workspaceId}/media/${mediaId}/labels/faces` },
    {
      name: 'People',
      href: `/ws/${workspaceId}/media/${mediaId}/labels/people`,
    },
    { name: 'Shots', href: `/ws/${workspaceId}/media/${mediaId}/labels/shots` },
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
