'use client';

import { LabelInspectorPage } from '@/components/labels/inspector/label-inspector-page';
import { OBJECTS_CONFIG } from '@/components/labels/inspector/config';

export default function LabelObjectsPage() {
  return <LabelInspectorPage config={OBJECTS_CONFIG} />;
}
