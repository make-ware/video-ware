'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

export default function WorkspaceRedirectPage() {
  const params = useParams();
  const router = useRouter();
  const workspaceId = params?.workspaceId as string | undefined;

  useEffect(() => {
    if (workspaceId) {
      router.replace(`/ws/${workspaceId}/uploads`);
    }
  }, [workspaceId, router]);

  // Show nothing while redirecting
  return null;
}
