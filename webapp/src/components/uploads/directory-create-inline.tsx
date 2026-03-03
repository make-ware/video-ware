'use client';

import { useState, useRef, useEffect } from 'react';
import { Check, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface DirectoryCreateInlineProps {
  onCreate: (name: string) => Promise<void>;
  onCancel: () => void;
  isCreating: boolean;
}

export function DirectoryCreateInline({
  onCreate,
  onCancel,
  isCreating,
}: DirectoryCreateInlineProps) {
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    await onCreate(trimmed);
  };

  return (
    <div className="flex items-center gap-2">
      <Input
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Folder name"
        className="h-8 text-sm"
        disabled={isCreating}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSubmit();
          if (e.key === 'Escape') onCancel();
        }}
      />
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={handleSubmit}
        disabled={isCreating || !name.trim()}
      >
        {isCreating ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Check className="h-4 w-4" />
        )}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={onCancel}
        disabled={isCreating}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
