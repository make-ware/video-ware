'use client';

import { LabelInspectorPage } from '@/components/labels/inspector/label-inspector-page';
import { SEGMENTS_CONFIG } from '@/components/labels/inspector/config';

export default function LabelSegmentsPage() {
  return <LabelInspectorPage config={SEGMENTS_CONFIG} />;
}
