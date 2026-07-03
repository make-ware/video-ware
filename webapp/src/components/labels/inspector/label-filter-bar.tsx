'use client';

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Search } from 'lucide-react';
import type { LabelListFilters } from './use-label-list';

const CONFIDENCE_OPTIONS = [
  { value: '0', label: 'Any confidence' },
  { value: '0.5', label: '≥ 50%' },
  { value: '0.7', label: '≥ 70%' },
  { value: '0.85', label: '≥ 85%' },
  { value: '0.95', label: '≥ 95%' },
];

const DURATION_OPTIONS = [
  { value: '0', label: 'Any duration' },
  { value: '1', label: '≥ 1s' },
  { value: '2', label: '≥ 2s' },
  { value: '5', label: '≥ 5s' },
  { value: '10', label: '≥ 10s' },
];

interface LabelFilterBarProps {
  filters: LabelListFilters;
  onChange: (filters: LabelListFilters) => void;
  /** Hide the text input when the label type has no searchable fields. */
  showQuery: boolean;
  searchPlaceholder?: string;
}

export function LabelFilterBar({
  filters,
  onChange,
  showQuery,
  searchPlaceholder = 'Search labels…',
}: LabelFilterBarProps) {
  return (
    <div className="space-y-2">
      {showQuery && (
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={filters.query}
            onChange={(e) => onChange({ ...filters, query: e.target.value })}
            placeholder={searchPlaceholder}
            className="pl-8 h-8"
          />
        </div>
      )}
      <div className="flex gap-2">
        <Select
          value={String(filters.minConfidence)}
          onValueChange={(v) =>
            onChange({ ...filters, minConfidence: Number(v) })
          }
        >
          <SelectTrigger className="h-8 flex-1 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CONFIDENCE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={String(filters.minDuration)}
          onValueChange={(v) =>
            onChange({ ...filters, minDuration: Number(v) })
          }
        >
          <SelectTrigger className="h-8 flex-1 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DURATION_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
