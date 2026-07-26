'use client';

import { ClipType } from '@project/shared/enums';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// Types are origins only. Composite is not a type: a clip with an edit list
// (any origin) shows a segments badge instead of living in a filter bucket.
export const CLIP_TYPE_OPTIONS = [
  { value: 'all', label: 'All Types' },
  { value: ClipType.USER, label: 'My Clips' },
  { value: ClipType.SHOT, label: 'Shots' },
  { value: ClipType.OBJECT, label: 'Objects' },
  { value: ClipType.PERSON, label: 'People' },
  { value: ClipType.FACE, label: 'Faces' },
  { value: ClipType.SPEECH, label: 'Speech' },
];

// The client-side predicate that used to live here is gone: every clip list is
// now filtered server-side (`type = {:type}` in MediaClipService.listClips),
// which is equivalent for every value this dropdown emits.

interface ClipTypeFilterProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function ClipTypeFilter({
  value,
  onChange,
  className,
}: ClipTypeFilterProps) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={className ?? 'w-[140px] h-8 text-xs'}>
        <SelectValue placeholder="All Types" />
      </SelectTrigger>
      <SelectContent>
        {CLIP_TYPE_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
