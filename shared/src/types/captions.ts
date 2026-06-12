import { z } from 'zod';

// ============================================================================
// Caption cue and style contracts
//
// A caption is a block of text displayed over video. Animation is modelled as
// a list of timed cues: each cue replaces the displayed text for its time
// window. Cue times are relative to the caption's own start (seconds), which
// makes the same data work for media-attached transcript captions and for
// ad-hoc captions placed on a timeline.
// ============================================================================

export const CaptionCueSchema = z.object({
  /** Text displayed during this cue */
  text: z.string(),
  /** Cue start in seconds, relative to the caption start */
  start: z.number().min(0),
  /** Cue end in seconds, relative to the caption start */
  end: z.number().min(0),
});

export type CaptionCue = z.infer<typeof CaptionCueSchema>;

export const CaptionStyleSchema = z.object({
  /** Font size in pixels at the render resolution (e.g. 48 for 1080p) */
  fontSize: z.number().optional(),
  /** Text color, hex e.g. #FFFFFF */
  color: z.string().optional(),
  /** Background box color, hex e.g. #000000. Omit for no box. */
  backgroundColor: z.string().optional(),
  /** Background box opacity 0.0–1.0 (default 0.6 when backgroundColor set) */
  backgroundOpacity: z.number().min(0).max(1).optional(),
  /** Vertical placement preset */
  position: z.enum(['top', 'middle', 'bottom']).optional(),
  /** Horizontal alignment preset */
  align: z.enum(['left', 'center', 'right']).optional(),
});

export type CaptionStyle = z.infer<typeof CaptionStyleSchema>;

/** Default style applied to subtitle-like captions */
export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  fontSize: 48,
  color: '#FFFFFF',
  backgroundColor: '#000000',
  backgroundOpacity: 0.6,
  position: 'bottom',
  align: 'center',
};

/** Default style applied to title screens */
export const DEFAULT_TITLE_STYLE: CaptionStyle = {
  fontSize: 96,
  color: '#FFFFFF',
  position: 'middle',
  align: 'center',
};
