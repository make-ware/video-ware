import { useState, useCallback, useEffect } from 'react';
import {
  LabelSpeech,
  LabelSpeechInput,
  LabelSpeechUpdate,
} from '@project/shared';
import { LabelSpeechMutator } from '@project/shared/mutator';
import pb from '@/lib/pocketbase-client';
import { useAuth } from './use-auth';
import { toast } from 'sonner';

export function useMediaTranscripts(mediaId: string) {
  const [transcripts, setTranscripts] = useState<LabelSpeech[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const { isAuthenticated } = useAuth();

  const fetchTranscripts = useCallback(async () => {
    if (!mediaId || !isAuthenticated) return;

    try {
      setIsLoading(true);
      setError(null);
      const mutator = new LabelSpeechMutator(pb);
      // Fetching up to 500 items for now.
      const result = await mutator.getByMedia(mediaId, 1, 500);
      // Sort by start time
      const items = result.items.sort((a, b) => a.start - b.start);
      setTranscripts(items);
    } catch (err) {
      console.error('Error fetching transcripts:', err);
      setError(
        err instanceof Error ? err : new Error('Failed to fetch transcripts')
      );
    } finally {
      setIsLoading(false);
    }
  }, [mediaId, isAuthenticated]);

  useEffect(() => {
    fetchTranscripts();
  }, [fetchTranscripts]);

  const createTranscript = async (input: LabelSpeechInput) => {
    try {
      const mutator = new LabelSpeechMutator(pb);
      await mutator.create(input);
      toast.success('Transcript added');
      fetchTranscripts();
    } catch (err) {
      console.error('Failed to create transcript:', err);
      toast.error('Failed to create transcript');
      throw err;
    }
  };

  const updateTranscript = async (id: string, input: LabelSpeechUpdate) => {
    try {
      const mutator = new LabelSpeechMutator(pb);
      await mutator.update(id, input);
      toast.success('Transcript updated');
      fetchTranscripts();
    } catch (err) {
      console.error('Failed to update transcript:', err);
      toast.error('Failed to update transcript');
      throw err;
    }
  };

  const deleteTranscript = async (id: string) => {
    try {
      const mutator = new LabelSpeechMutator(pb);
      await mutator.delete(id);
      toast.success('Transcript deleted');
      fetchTranscripts();
    } catch (err) {
      console.error('Failed to delete transcript:', err);
      toast.error('Failed to delete transcript');
      throw err;
    }
  };

  return {
    transcripts,
    isLoading,
    error,
    refresh: fetchTranscripts,
    createTranscript,
    updateTranscript,
    deleteTranscript,
  };
}
