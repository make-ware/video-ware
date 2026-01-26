import React, { useMemo } from 'react';
import { LabelSpeech } from '@project/shared';
import { cn } from '@/lib/utils';

interface TranscriptOverlayProps {
  transcripts: LabelSpeech[];
  currentTime: number;
  isVisible: boolean;
  className?: string;
}

export function TranscriptOverlay({
  transcripts,
  currentTime,
  isVisible,
  className,
}: TranscriptOverlayProps) {
  const activeTranscripts = useMemo(() => {
    if (!isVisible) return [];
    return transcripts.filter(
      (t) => currentTime >= t.start && currentTime <= t.end
    );
  }, [transcripts, currentTime, isVisible]);

  if (activeTranscripts.length === 0) return null;

  return (
    <div
      className={cn(
        'absolute bottom-20 left-0 right-0 flex flex-col items-center gap-1 pointer-events-none px-4 z-10',
        className
      )}
    >
      {activeTranscripts.map((t) => (
        <div
          key={t.id}
          className="bg-black/70 text-white px-4 py-2 rounded text-lg text-center max-w-3xl backdrop-blur-sm shadow-lg"
        >
          {t.transcript}
        </div>
      ))}
    </div>
  );
}
