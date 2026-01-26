'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TimeInputProps extends Omit<
  React.ComponentProps<typeof Input>,
  'onChange' | 'value'
> {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}

export function TimeInput({
  value,
  onChange,
  min = 0,
  max,
  step = 0.1,
  className,
  ...props
}: TimeInputProps) {
  const handleIncrement = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const newValue = Math.round((value + 1) * 10) / 10;
    if (max === undefined || newValue <= max) {
      onChange(newValue);
    } else if (max !== undefined) {
      onChange(max);
    }
  };

  const handleDecrement = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const newValue = Math.round((value - 1) * 10) / 10;
    if (newValue >= min) {
      onChange(newValue);
    } else {
      onChange(min);
    }
  };

  return (
    <div className={cn('flex items-center gap-1', className)}>
      <Button
        variant="outline"
        size="icon"
        className="h-7 w-7 shrink-0"
        onClick={handleDecrement}
        disabled={value <= min}
      >
        <Minus className="h-3 w-3" />
      </Button>
      <Input
        type="number"
        step={step}
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="h-7 text-xs font-mono"
        {...props}
      />
      <Button
        variant="outline"
        size="icon"
        className="h-7 w-7 shrink-0"
        onClick={handleIncrement}
        disabled={max !== undefined && value >= max}
      >
        <Plus className="h-3 w-3" />
      </Button>
    </div>
  );
}
