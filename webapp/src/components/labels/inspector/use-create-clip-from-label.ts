'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ClipType, LabelType } from '@project/shared';
import type { LabelSpeech, MediaClip } from '@project/shared';
import {
  MediaClipMutator,
  MediaClipLabelMutator,
  type ActualizableLabel,
} from '@project/shared/mutator';
import { usePocketBase } from '@/contexts/pocketbase-context';
import { qk } from '@/lib/query-keys';
import {
  deriveClipMeta,
  deriveMergedSpeechMeta,
  truncateChars,
} from './derive-clip-label';

const PROCESSOR = 'inspector';

export type CreateClipRequest =
  | { kind: 'single'; labelType: LabelType; record: ActualizableLabel }
  | { kind: 'merge-speech'; segments: LabelSpeech[] };

interface CreateClipResult {
  clip: MediaClip;
  label: string;
}

/**
 * One-click clip creation from label rows. Single labels go through the
 * shared createFromLabel (which also writes the MediaClipLabels provenance
 * edge); merged speech selections create the clip manually and link every
 * source segment. Success shows a toast with "View clip" and "Undo" actions.
 */
export function useCreateClipFromLabel() {
  const { pb } = usePocketBase();
  const queryClient = useQueryClient();
  const router = useRouter();
  const params = useParams();
  const workspaceId = params.workspaceId as string;
  const mediaId = params.id as string;

  const invalidateClips = () =>
    queryClient.invalidateQueries({ queryKey: qk.media.detail(mediaId) });

  return useMutation({
    mutationFn: async (req: CreateClipRequest): Promise<CreateClipResult> => {
      const mutator = new MediaClipMutator(pb);

      if (req.kind === 'single') {
        const meta = deriveClipMeta(req.labelType, req.record);
        let clip = await mutator.createFromLabel(
          req.record,
          req.labelType,
          PROCESSOR
        );
        try {
          clip = await mutator.update(clip.id, {
            label: meta.label,
            description: meta.description ?? '',
          });
        } catch (err) {
          // The clip exists and is linked — it just isn't named.
          console.error('Failed to name the created clip:', err);
          toast.warning('Clip created, but naming it failed');
        }
        return { clip, label: meta.label };
      }

      const segments = [...req.segments].sort((a, b) => a.start - b.start);
      if (segments.length === 0) {
        throw new Error('No segments selected');
      }
      const first = segments[0];
      const start = first.start;
      const end = Math.max(...segments.map((s) => s.end));
      const meta = deriveMergedSpeechMeta(segments);
      const confidence = Math.min(...segments.map((s) => s.confidence));

      const clip = await mutator.create({
        WorkspaceRef: first.WorkspaceRef,
        MediaRef: first.MediaRef,
        type: ClipType.SPEECH,
        start,
        end,
        duration: end - start,
        version: 1,
        processor: PROCESSOR,
        label: meta.label,
        description: meta.description,
        clipData: {
          sourceType: 'label',
          labelType: LabelType.SPEECH,
          confidence,
        },
      });

      const linkMutator = new MediaClipLabelMutator(pb);
      for (const segment of segments) {
        await linkMutator.linkLabel({
          workspaceId: first.WorkspaceRef,
          clipId: clip.id,
          labelType: LabelType.SPEECH,
          labelId: segment.id,
          confidence: segment.confidence,
          metadata: { transcript: truncateChars(segment.transcript, 200) },
        });
      }
      return { clip, label: meta.label };
    },
    onSuccess: ({ clip, label }) => {
      void invalidateClips();
      const clipUrl = `/ws/${workspaceId}/media/${mediaId}?clip=${clip.id}`;
      toast.success(`Clip created: "${label}"`, {
        action: {
          label: 'View clip',
          onClick: () => router.push(clipUrl),
        },
        cancel: {
          label: 'Undo',
          onClick: () => {
            void (async () => {
              try {
                // Cascade delete removes the MediaClipLabels edges too.
                await new MediaClipMutator(pb).delete(clip.id);
                void invalidateClips();
                toast.success('Clip removed');
              } catch (err) {
                console.error('Failed to undo clip creation:', err);
                toast.error('Failed to undo clip creation');
              }
            })();
          },
        },
      });
    },
    onError: (err) => {
      console.error('Failed to create clip:', err);
      toast.error('Failed to create clip', {
        description: err instanceof Error ? err.message : undefined,
      });
    },
  });
}
