/**
 * Speaker labeling helpers shared by the webapp and CLI so diarized speaker
 * names read identically everywhere. The provider only gives opaque ids
 * ("speaker_0"); a real name is resolved live from the linked Entity at
 * render time and passed in — never baked into stored transcripts.
 */

/**
 * Human-readable name for a provider speaker id: "speaker_0" -> "Speaker 1"
 * (1-based); ids that don't match the pattern pass through unchanged. Mirrors
 * the worker's speaker-transcription normalizer so generated names agree with
 * the auto-created LabelEntity canonicalNames.
 */
export function prettySpeakerId(speakerId: string): string {
  const match = /^speaker_(\d+)$/.exec(speakerId);
  if (match) {
    return `Speaker ${parseInt(match[1], 10) + 1}`;
  }
  return speakerId;
}

/**
 * Speaker label for generated transcript text: the prettified provider id
 * with the linked entity's name in parentheses once the speaker is
 * identified — "Speaker 1 (Erik)" — else just the id, "Speaker 1".
 *
 * `entityName` is resolved live by the caller from the speaker's
 * LabelTrack.EntityRef; a blank name, or one equal to the pretty id, collapses
 * to the id alone so we never render "Speaker 1 (Speaker 1)".
 */
export function speakerTranscriptLabel(
  speakerId: string,
  entityName?: string | null
): string {
  const pretty = prettySpeakerId(speakerId);
  const name = entityName?.trim();
  return name && name !== pretty ? `${pretty} (${name})` : pretty;
}
