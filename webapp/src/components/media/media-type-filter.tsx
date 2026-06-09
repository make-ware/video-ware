'use client';

import { MediaType } from '@project/shared';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MediaTypeIcon, type MediaTypeValue } from './media-type-icon';

export const MEDIA_TYPE_OPTIONS = [
  { value: 'all', label: 'All Media' },
  { value: MediaType.VIDEO, label: 'Video' },
  { value: MediaType.AUDIO, label: 'Audio' },
  { value: MediaType.IMAGE, label: 'Image' },
];

/**
 * Returns a predicate that tests whether a media type matches the filter value.
 */
export function mediaTypeFilterPredicate(
  filterValue: string
): (mediaType: MediaTypeValue) => boolean {
  if (filterValue === 'all') return () => true;
  return (mediaType) => {
    const value = Array.isArray(mediaType) ? mediaType[0] : mediaType;
    return value === filterValue;
  };
}

interface MediaTypeFilterProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function MediaTypeFilter({
  value,
  onChange,
  className,
}: MediaTypeFilterProps) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={className ?? 'w-[150px] h-7 text-xs'}>
        <SelectValue placeholder="All Media" />
      </SelectTrigger>
      <SelectContent>
        {MEDIA_TYPE_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            <span className="flex items-center gap-2">
              {option.value !== 'all' && (
                <MediaTypeIcon
                  mediaType={option.value}
                  className="h-3.5 w-3.5"
                />
              )}
              {option.label}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
