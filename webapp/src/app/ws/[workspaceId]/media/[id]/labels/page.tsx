'use client';

import { redirect, useParams } from 'next/navigation';

export default function LabelsPage() {
  const params = useParams();
  const workspaceId = params.workspaceId as string;
  const mediaId = params.id as string;
  redirect(`/ws/${workspaceId}/media/${mediaId}/labels/objects`);
}
