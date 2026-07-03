'use client';

import { LabelInspectorPage } from '@/components/labels/inspector/label-inspector-page';
import { TEXT_CONFIG } from '@/components/labels/inspector/config';

export default function LabelTextPage() {
  return <LabelInspectorPage config={TEXT_CONFIG} />;
}
