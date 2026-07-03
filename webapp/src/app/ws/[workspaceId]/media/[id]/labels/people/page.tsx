'use client';

import { LabelInspectorPage } from '@/components/labels/inspector/label-inspector-page';
import { PEOPLE_CONFIG } from '@/components/labels/inspector/config';

export default function LabelPeoplePage() {
  return <LabelInspectorPage config={PEOPLE_CONFIG} />;
}
