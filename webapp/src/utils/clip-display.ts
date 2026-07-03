/** Loose shape so MediaClips, expanded clips, and dialog unions all fit. */
interface ClipDisplayFields {
  label?: string;
  description?: string;
  clipData?: unknown;
}

/**
 * Display name for a MediaClip. Prefers the editor-facing top-level `label`,
 * falls back to the legacy `clipData.label` written by older processors,
 * then to `fallback`.
 */
export function getClipDisplayLabel(
  clip: ClipDisplayFields,
  fallback = 'Clip'
): string {
  const label = clip.label?.trim();
  if (label) return label;

  const clipData = (clip.clipData as Record<string, unknown>) || {};
  const legacy =
    typeof clipData.label === 'string' ? clipData.label.trim() : '';
  if (legacy) return legacy;

  return fallback;
}

/** Top-level description, or undefined when empty (no legacy fallback). */
export function getClipDescription(
  clip: ClipDisplayFields
): string | undefined {
  const description = clip.description?.trim();
  return description || undefined;
}
