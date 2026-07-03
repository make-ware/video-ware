'use client';

import { LabelInspectorPage } from '@/components/labels/inspector/label-inspector-page';
import { FACES_CONFIG } from '@/components/labels/inspector/config';

export default function LabelFacesPage() {
  return <LabelInspectorPage config={FACES_CONFIG} />;
}
