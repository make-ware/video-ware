'use client';

import { redirect, useParams } from 'next/navigation';

export default function LabelsPage() {
  const params = useParams();
  const mediaId = params.id as string;
  redirect(`/media/${mediaId}/labels/objects`);
}
