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
  const activeTranscript = useMemo(() => {
    if (!isVisible) return null;
    return transcripts.find(
      (t) => currentTime >= t.start && currentTime <= t.end
    );
  }, [transcripts, currentTime, isVisible]);

  if (!activeTranscript) return null;

  return (
    <div
      className={cn(
        'absolute bottom-20 left-0 right-0 flex justify-center pointer-events-none px-4 z-10',
        className
      )}
    >
      <div className="bg-black/70 text-white px-4 py-2 rounded text-lg text-center max-w-3xl backdrop-blur-sm shadow-lg">
        {activeTranscript.transcript}
      </div>
    </div>
  );
}
