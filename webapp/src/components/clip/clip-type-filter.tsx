'use client';

import { ClipType } from '@project/shared/enums';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export const CLIP_TYPE_OPTIONS = [
  { value: 'all', label: 'All Types' },
  { value: 'media', label: 'Media' },
  { value: 'clips', label: 'Clips' },
  { value: ClipType.OBJECT, label: 'Object' },
  { value: ClipType.FACE, label: 'Face' },
  { value: ClipType.SPEECH, label: 'Speech' },
  { value: ClipType.RECOMMENDATION, label: 'Recommendations' },
];

const MEDIA_TYPES = new Set<string>([ClipType.FULL]);

const CLIP_TYPES = new Set<string>([
  ClipType.USER,
  ClipType.RANGE,
  ClipType.SHOT,
  ClipType.OBJECT,
  ClipType.PERSON,
  ClipType.FACE,
  ClipType.SPEECH,
  ClipType.COMPOSITE,
]);

/**
 * Returns a predicate that tests whether a clip type matches the filter value.
 */
export function clipTypeFilterPredicate(
  filterValue: string
): (type: string) => boolean {
  if (filterValue === 'all') return () => true;
  if (filterValue === 'media') return (type) => MEDIA_TYPES.has(type);
  if (filterValue === 'clips') return (type) => CLIP_TYPES.has(type);
  return (type) => type === filterValue;
}

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
