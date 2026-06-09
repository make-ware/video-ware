import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  LabelSpeech,
  LabelSpeechInput,
  LabelSpeechUpdate,
} from '@project/shared';
import { LabelSpeechMutator } from '@project/shared/mutator';
import pb from '@/lib/pocketbase-client';
import { qk } from '@/lib/query-keys';
import { useAuth } from './use-auth';
import { toast } from 'sonner';

export function useMediaTranscripts(mediaId: string) {
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();

  const queryKey = qk.transcripts.byMedia(mediaId);
  const invalidate = () => queryClient.invalidateQueries({ queryKey });

  const query = useQuery({
    queryKey,
    enabled: !!mediaId && isAuthenticated,
    queryFn: async () => {
      const mutator = new LabelSpeechMutator(pb);
      // Fetching up to 500 items for now.
      const result = await mutator.getByMedia(mediaId, 1, 500);
      // Sort by start time
      return result.items.sort((a, b) => a.start - b.start);
    },
  });

  const createMutation = useMutation({
    mutationFn: (input: LabelSpeechInput) =>
      new LabelSpeechMutator(pb).create(input),
    onSuccess: () => {
      toast.success('Transcript added');
      invalidate();
    },
    onError: (err) => {
      console.error('Failed to create transcript:', err);
      toast.error('Failed to create transcript');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: LabelSpeechUpdate }) =>
      new LabelSpeechMutator(pb).update(id, input),
    onSuccess: () => {
      toast.success('Transcript updated');
      invalidate();
    },
    onError: (err) => {
      console.error('Failed to update transcript:', err);
      toast.error('Failed to update transcript');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => new LabelSpeechMutator(pb).delete(id),
    onSuccess: () => {
      toast.success('Transcript deleted');
      invalidate();
    },
    onError: (err) => {
      console.error('Failed to delete transcript:', err);
      toast.error('Failed to delete transcript');
    },
  });

  return {
    transcripts: (query.data ?? []) as LabelSpeech[],
    isLoading: query.isLoading,
    error: query.error,
    refresh: async () => {
      await invalidate();
    },
    createTranscript: async (input: LabelSpeechInput): Promise<void> => {
      await createMutation.mutateAsync(input);
    },
    updateTranscript: async (
      id: string,
      input: LabelSpeechUpdate
    ): Promise<void> => {
      await updateMutation.mutateAsync({ id, input });
    },
    deleteTranscript: async (id: string): Promise<void> => {
      await deleteMutation.mutateAsync(id);
    },
  };
}
