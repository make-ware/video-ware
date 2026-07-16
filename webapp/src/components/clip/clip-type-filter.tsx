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
  { value: ClipType.USER, label: 'My Clips' },
  { value: ClipType.COMPOSITE, label: 'Composite' },
  { value: ClipType.SHOT, label: 'Shots' },
  { value: ClipType.OBJECT, label: 'Objects' },
  { value: ClipType.PERSON, label: 'People' },
  { value: ClipType.FACE, label: 'Faces' },
  { value: ClipType.SPEECH, label: 'Speech' },
];

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
  if (filterValue === 'user') return (type) => type === ClipType.USER;
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
