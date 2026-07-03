'use client';

import { LabelInspectorPage } from '@/components/labels/inspector/label-inspector-page';
import { SHOTS_CONFIG } from '@/components/labels/inspector/config';

export default function LabelShotsPage() {
  return <LabelInspectorPage config={SHOTS_CONFIG} />;
}
