'use client';

import Link from 'next/link';
import { usePathname, useParams } from 'next/navigation';
import { LabelType, mediaTypeSupportsLabelType } from '@project/shared';
import { Button } from '@/components/ui/button';
import { INSPECTOR_CONFIGS } from '@/components/labels/inspector/config';
import { normalizeMediaType } from '@/components/media';
import { useMediaDetails } from '@/hooks/use-media-details';

export function LabelsNav() {
  const pathname = usePathname();
  const params = useParams();
  const workspaceId = params.workspaceId as string;
  const mediaId = params.id as string;
  const { media } = useMediaDetails(mediaId);
  const mediaType = normalizeMediaType(media?.mediaType);

  const base = `/ws/${workspaceId}/media/${mediaId}/labels`;
  const allTabs = [
    {
      name: 'Speakers',
      href: `${base}/speakers`,
      labelType: LabelType.SPEAKER,
    },
    ...INSPECTOR_CONFIGS.map((config) => ({
      name: config.title,
      href: `${base}/${config.key}`,
      labelType: config.labelType,
    })),
    {
      name: 'Transcripts',
      href: `${base}/transcripts`,
      labelType: LabelType.SPEECH,
    },
  ];

  // Only surface tabs whose label type can exist for this media type (audio →
  // Speakers + Transcripts; video → all). Until the media loads, show all.
  const tabs = mediaType
    ? allTabs.filter((tab) =>
        mediaTypeSupportsLabelType(mediaType, tab.labelType)
      )
    : allTabs;

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
