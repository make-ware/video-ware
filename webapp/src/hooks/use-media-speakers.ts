import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LabelSpeakerMutator,
  SPEAKER_PANEL_FIELDS,
  SPEAKER_SUMMARY_FIELDS,
} from '@project/shared/mutator';
import pb from '@/lib/pocketbase-client';
import { qk } from '@/lib/query-keys';
import { useAuth } from './use-auth';
import {
  deriveSpeakerSummaries,
  formatDiarizedTranscript,
  speakerTranscriptLabelFor,
  type SpeakerSummary,
  type SpeakerUtterance,
} from '@/components/labels/speakers/speaker-utils';

/**
 * Diarized speaker utterances for a media, sorted by start time.
 *
 * Expands the per-speaker LabelEntity and, through it, the linked Entity.
 * That one expand is the panel's whole identity story: LabelEntity carries
 * both the display name (which survives entity renames) and the "this speaker
 * is Erik" link, so identifying a speaker needs no second query.
 *
 * Fetched as a batched full list, not a single oversized page — a long
 * recording runs to thousands of utterances, and a capped page would drop the
 * tail silently while the "N found" count reported the truncated total as
 * fact. The `fields` projection drops the per-word timings, which no speaker
 * surface reads and which dominate the payload.
 *
 * This is the WHOLE-MEDIA read, for surfaces that genuinely need every
 * utterance at once (the media page's transcript panel). The speakers label
 * page pages its list through `useLabelList` instead and takes only the two
 * aggregates below.
 */
export function useMediaSpeakers(mediaId: string) {
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();

  const queryKey = qk.speakers.byMedia(mediaId);

  const query = useQuery({
    queryKey,
    enabled: !!mediaId && isAuthenticated,
    queryFn: async () => {
      const mutator = new LabelSpeakerMutator(pb, {
        fields: [...SPEAKER_PANEL_FIELDS],
      });
      // getAllByMedia takes the dotted expand path directly.
      const items = await mutator.getAllByMedia(mediaId, [
        'LabelEntityRef.EntityRef',
      ]);
      return items.sort((a, b) => a.start - b.start);
    },
  });

  return {
    utterances: (query.data ?? []) as SpeakerUtterance[],
    isLoading: query.isLoading,
    error: query.error,
    refresh: async () => {
      await queryClient.invalidateQueries({ queryKey });
    },
  };
}

/**
 * Per-speaker aggregate over EVERY utterance in the media: who spoke, how
 * often, for how long, and which Entity they are linked to.
 *
 * Separate from the paged utterance list on purpose. The chips are a
 * whole-media summary — counts and speaking time computed from one loaded page
 * would simply be wrong — but they read no transcript text, so
 * SPEAKER_SUMMARY_FIELDS makes the full-list read cheap enough to always run.
 */
export function useMediaSpeakerSummaries(mediaId: string) {
  const { isAuthenticated } = useAuth();

  const query = useQuery({
    queryKey: qk.speakers.summaries(mediaId),
    enabled: !!mediaId && isAuthenticated,
    queryFn: async (): Promise<SpeakerSummary[]> => {
      const mutator = new LabelSpeakerMutator(pb, {
        fields: [...SPEAKER_SUMMARY_FIELDS],
      });
      const items = (await mutator.getAllByMedia(mediaId, [
        'LabelEntityRef.EntityRef',
      ])) as SpeakerUtterance[];
      // colorIndex is assigned by first appearance, so the sort is part of the
      // contract, not a display detail.
      return deriveSpeakerSummaries(
        [...items].sort((a, b) => a.start - b.start)
      );
    },
  });

  return {
    speakers: query.data ?? [],
    isLoading: query.isPending,
    error: query.error,
  };
}

/**
 * The whole diarized transcript as plain text — "Speaker 1 (Erik): …"
 * paragraphs, entity names resolved live.
 *
 * Shared options rather than a bare hook so the Copy button can pull the same
 * cache entry through `queryClient.fetchQuery` when the Raw Text tab was never
 * opened, instead of a second full-media read.
 */
export function speakerTextQueryOptions(mediaId: string) {
  return queryOptions({
    queryKey: qk.speakers.text(mediaId),
    queryFn: async (): Promise<string> => {
      const mutator = new LabelSpeakerMutator(pb, {
        fields: [...SPEAKER_PANEL_FIELDS],
      });
      const items = (await mutator.getAllByMedia(mediaId, [
        'LabelEntityRef.EntityRef',
      ])) as SpeakerUtterance[];
      return formatDiarizedTranscript(
        [...items].sort((a, b) => a.start - b.start),
        speakerTranscriptLabelFor
      );
    },
  });
}

/** Lazily-fetched diarized transcript; `enabled` gates the whole-media read. */
export function useMediaSpeakerText(mediaId: string, enabled: boolean) {
  const { isAuthenticated } = useAuth();
  const query = useQuery({
    ...speakerTextQueryOptions(mediaId),
    enabled: enabled && !!mediaId && isAuthenticated,
  });
  return {
    text: query.data ?? '',
    isLoading: query.isFetching,
    error: query.error,
  };
}
