import { InvalidArgumentError } from 'commander';
import {
  CaptionMutator,
  CaptionStyleSchema,
  CaptionType,
  DEFAULT_CAPTION_STYLE,
  DEFAULT_TITLE_STYLE,
  TimelineClipMutator,
  splitTextIntoCues,
  type Caption,
  type CaptionCue,
  type CaptionInput,
  type CaptionStyle,
  type CaptionUpdate,
  type TypedPocketBase,
} from '@project/shared';
import {
  parseSeconds,
  parseUnitInterval,
  type OptionGroupOf,
} from './options.js';

/**
 * Caption creation/editing for the CLI, built directly on @project/shared's
 * CaptionMutator. Captions are the shared model behind on-screen text: a
 * "caption" is a subtitle-style overlay, a "title" is a large centered title
 * card. Both are placed on a timeline as a clip via `vw timeline insert
 * --caption <id>` (see insertClip in timeline.ts), mirroring the webapp's
 * CaptionEditorModal → addCaptionClip flow.
 *
 * Captions created here are "ad-hoc" (no MediaRef) — the user-authored kind the
 * timeline editor places directly, as opposed to transcript/TTS captions that
 * are attached to a source media.
 */

/** The style flag keys shared by `caption create` and `caption update`. */
interface CaptionStyleFields {
  /** Full style object as JSON; individual flags below override it. */
  style?: CaptionStyle;
  /** Font size in pixels at 1080p (e.g. 48 for captions, 96 for titles). */
  fontSize?: number;
  /** Text color, hex e.g. #FFFFFF. */
  color?: string;
  /** Background box color, hex e.g. #000000. */
  bgColor?: string;
  /** Background box opacity 0.0–1.0. */
  bgOpacity?: number;
  /** Vertical placement. */
  position?: 'top' | 'middle' | 'bottom';
  /** Horizontal alignment. */
  align?: 'left' | 'center' | 'right';
}

/** Human-readable caption name: name → text snippet → id. */
export function captionLabel(caption: Caption): string {
  if (caption.name) return caption.name;
  if (caption.text) return caption.text;
  return caption.id;
}

/** Normalize captionType (PocketBase select fields round-trip as arrays). */
export function captionTypeOf(caption: Caption): CaptionType {
  const raw = Array.isArray(caption.captionType)
    ? caption.captionType[0]
    : caption.captionType;
  return raw as CaptionType;
}

/** Validate a `--type` flag against the CaptionType enum. */
export function parseCaptionType(value: string): CaptionType {
  const values = Object.values(CaptionType) as string[];
  if (!values.includes(value)) {
    throw new InvalidArgumentError(`expected one of: ${values.join(', ')}`);
  }
  return value as CaptionType;
}

/** Build a parser that validates a value against a fixed set of choices. */
function parseChoice<T extends string>(
  choices: readonly T[]
): (value: string) => T {
  return (value: string) => {
    if (!(choices as readonly string[]).includes(value)) {
      throw new InvalidArgumentError(`expected one of: ${choices.join(', ')}`);
    }
    return value as T;
  };
}

/** Parse and validate a full `--style` JSON blob against CaptionStyleSchema. */
export function parseStyleJson(value: string): CaptionStyle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new InvalidArgumentError('expected a JSON object');
  }
  const result = CaptionStyleSchema.safeParse(parsed);
  if (!result.success) {
    throw new InvalidArgumentError(
      `invalid style: ${result.error.issues.map((i) => i.message).join('; ')}`
    );
  }
  return result.data;
}

/**
 * Presentation flags shared by `caption create`/`update`. The `--style` JSON is
 * the base, then the individual flags override matching properties, so an agent
 * can pass a full style object or nudge one property. The `satisfies` clause
 * ties the group to CaptionStyleFields; flag attribute names match the keys.
 */
export const captionStyleOptions = {
  style: {
    flags: '--style <json>',
    description:
      'full caption style as a JSON object (individual flags override)',
    parse: parseStyleJson,
  },
  fontSize: {
    flags: '--font-size <px>',
    description: 'font size in pixels at 1080p',
    parse: parseFloat,
  },
  color: { flags: '--color <hex>', description: 'text color, e.g. #FFFFFF' },
  bgColor: {
    flags: '--bg-color <hex>',
    description: 'background box color, e.g. #000000 (omit for no box)',
  },
  bgOpacity: {
    flags: '--bg-opacity <0-1>',
    description: 'background box opacity',
    parse: parseUnitInterval,
  },
  position: {
    flags: '--position <top|middle|bottom>',
    description: 'vertical placement',
    parse: parseChoice(['top', 'middle', 'bottom'] as const),
  },
  align: {
    flags: '--align <left|center|right>',
    description: 'horizontal alignment',
    parse: parseChoice(['left', 'center', 'right'] as const),
  },
} satisfies OptionGroupOf<CaptionStyleFields>;

/** The default style for a caption type (subtitle-style vs. title card). */
function defaultStyleFor(type: CaptionType): CaptionStyle {
  return type === CaptionType.TITLE
    ? { ...DEFAULT_TITLE_STYLE }
    : { ...DEFAULT_CAPTION_STYLE };
}

/**
 * The explicit style overrides the caller passed: the `--style` JSON base with
 * the individual style flags layered on top. No type default is applied — this
 * is what should be merged onto an existing style when editing.
 */
function styleOverrides(fields: CaptionStyleFields): CaptionStyle {
  const overrides: CaptionStyle = { ...(fields.style ?? {}) };
  if (fields.fontSize !== undefined) overrides.fontSize = fields.fontSize;
  if (fields.color !== undefined) overrides.color = fields.color;
  if (fields.bgColor !== undefined) overrides.backgroundColor = fields.bgColor;
  if (fields.bgOpacity !== undefined)
    overrides.backgroundOpacity = fields.bgOpacity;
  if (fields.position !== undefined) overrides.position = fields.position;
  if (fields.align !== undefined) overrides.align = fields.align;
  return overrides;
}

/**
 * Compose the style for a brand-new caption (or one whose type just changed):
 * the type's default preset with the caller's overrides layered on top.
 */
function resolveStyle(
  type: CaptionType,
  fields: CaptionStyleFields
): CaptionStyle {
  return { ...defaultStyleFor(type), ...styleOverrides(fields) };
}

/** Cues from the caption's text lines, evenly timed across its duration. */
function cuesFor(
  animate: boolean,
  text: string,
  duration: number
): CaptionCue[] {
  if (!animate) return [];
  return splitTextIntoCues(text, duration);
}

export interface CreateCaptionOptions extends CaptionStyleFields {
  workspaceId: string;
  /** The on-screen text. Required — validated at runtime for a clear message. */
  text?: string;
  /** caption (subtitle overlay) or title (large title card). Default caption. */
  type?: CaptionType;
  /** Intrinsic duration in seconds. Default 5. */
  duration?: number;
  /** Editor-facing caption name (searchable). Defaults to the text. */
  name?: string;
  /** Split the text into evenly-timed cues (one per line/sentence). */
  animate?: boolean;
  /** User id for UserRef. Defaults to the authenticated user. */
  userId?: string;
}

/** `caption create` value flags (excluding the shared style group). */
export const captionCreateOptions = {
  text: {
    flags: '--text <text>',
    description: 'the on-screen text (required)',
  },
  type: {
    flags: '--type <caption|title>',
    description: 'caption (subtitle) or title (title card); default caption',
    parse: parseCaptionType,
  },
  duration: {
    flags: '-d, --duration <seconds>',
    description: 'how long the caption shows (default: 5)',
    parse: parseSeconds,
  },
  name: {
    flags: '--name <text>',
    description: 'caption name shown in the editor (defaults to the text)',
  },
} satisfies OptionGroupOf<CreateCaptionOptions>;

/** Default caption duration (seconds), matching the webapp editor. */
export const DEFAULT_CAPTION_DURATION = 5;

/**
 * Create an ad-hoc caption (no MediaRef) — a subtitle-style caption or a title
 * card. The style is the type's default merged with any style flags; `animate`
 * splits the text into timed cues. Mirrors the webapp CaptionEditorModal save.
 */
export async function createCaption(
  pb: TypedPocketBase,
  opts: CreateCaptionOptions
): Promise<Caption> {
  const text = opts.text?.trim();
  if (!text) {
    throw new Error('Caption text is required — pass --text <text>.');
  }
  const type = opts.type ?? CaptionType.CAPTION;
  const duration = opts.duration ?? DEFAULT_CAPTION_DURATION;
  if (!(duration > 0)) {
    throw new Error(`Duration must be greater than zero (got ${duration}).`);
  }

  const style = resolveStyle(type, opts);
  const cues = cuesFor(!!opts.animate, text, duration);
  const userId = opts.userId ?? pb.authStore.record?.id;

  const input: CaptionInput = {
    WorkspaceRef: opts.workspaceId,
    ...(userId ? { UserRef: userId } : {}),
    ...(opts.name !== undefined ? { name: opts.name } : {}),
    captionType: type,
    text,
    ...(cues.length > 0 ? { cues } : {}),
    duration,
    style,
  };

  return new CaptionMutator(pb).create(input);
}

export interface UpdateCaptionOptions extends CaptionStyleFields {
  /** New on-screen text. */
  text?: string;
  /** Change the caption type (caption ↔ title). Resets style to that default. */
  type?: CaptionType;
  /** New intrinsic duration in seconds. */
  duration?: number;
  /** New caption name. */
  name?: string;
  /** Regenerate timed cues from the (new or existing) text and duration. */
  animate?: boolean;
}

/** `caption update` value flags (excluding the shared style group). */
export const captionUpdateOptions = {
  text: { flags: '--text <text>', description: 'new on-screen text' },
  type: {
    flags: '--type <caption|title>',
    description: 'change type (resets style to that type default)',
    parse: parseCaptionType,
  },
  duration: {
    flags: '-d, --duration <seconds>',
    description: 'new duration in seconds',
    parse: parseSeconds,
  },
  name: { flags: '--name <text>', description: 'new caption name' },
} satisfies OptionGroupOf<UpdateCaptionOptions>;

/**
 * Patch a caption's text/type/duration/name/style/cues. Editing the caption
 * updates every timeline clip that references it (the clip holds a CaptionRef),
 * so a title-card typo can be fixed without touching the timeline. Only the
 * fields actually passed are written. Passing `--style`/style flags or a new
 * `--type` recomputes the stored style; `--animate` regenerates cues.
 */
export async function updateCaption(
  pb: TypedPocketBase,
  captionId: string,
  opts: UpdateCaptionOptions
): Promise<Caption> {
  const mutator = new CaptionMutator(pb);
  const existing = await mutator.getById(captionId);
  if (!existing) {
    throw new Error(`Caption not found: ${captionId}`);
  }

  const patch: CaptionUpdate = {};
  if (opts.name !== undefined) patch.name = opts.name;
  if (opts.type !== undefined) patch.captionType = opts.type;

  const text = opts.text?.trim();
  if (opts.text !== undefined) {
    if (!text) throw new Error('Caption text cannot be empty.');
    patch.text = text;
  }

  if (opts.duration !== undefined) {
    if (!(opts.duration > 0)) {
      throw new Error(
        `Duration must be greater than zero (got ${opts.duration}).`
      );
    }
    patch.duration = opts.duration;
  }

  const styleFlagged =
    opts.style !== undefined ||
    opts.fontSize !== undefined ||
    opts.color !== undefined ||
    opts.bgColor !== undefined ||
    opts.bgOpacity !== undefined ||
    opts.position !== undefined ||
    opts.align !== undefined;
  // A type change re-bases the style on that type's default even without style
  // flags, matching the editor (switching caption↔title swaps the preset).
  if (styleFlagged || opts.type !== undefined) {
    patch.style =
      opts.type !== undefined
        ? // type change re-bases on the new type's default preset
          resolveStyle(opts.type, opts)
        : // same type: keep the existing style, apply only explicit overrides
          {
            ...((existing.style ?? {}) as CaptionStyle),
            ...styleOverrides(opts),
          };
  }

  if (opts.animate) {
    const effectiveText = patch.text ?? existing.text;
    const effectiveDuration = patch.duration ?? existing.duration;
    patch.cues = splitTextIntoCues(effectiveText, effectiveDuration);
  }

  if (Object.keys(patch).length === 0) {
    throw new Error('Nothing to update — pass at least one field flag.');
  }

  return mutator.update(captionId, patch);
}

export interface DeleteCaptionResult {
  caption: Caption;
  /** Timeline clip ids that referenced this caption (across all timelines). */
  referencingClipIds: string[];
}

/**
 * Delete a caption. Refuses when timeline clips still reference it (deleting
 * would leave dangling CaptionRefs that `timeline doctor` flags) unless
 * `force` is set. Returns the referencing clip ids either way.
 */
export async function deleteCaption(
  pb: TypedPocketBase,
  captionId: string,
  opts: { force?: boolean } = {}
): Promise<DeleteCaptionResult> {
  const mutator = new CaptionMutator(pb);
  const caption = await mutator.getById(captionId);
  if (!caption) {
    throw new Error(`Caption not found: ${captionId}`);
  }

  const refs = await new TimelineClipMutator(pb).getList(
    1,
    500,
    pb.filter('CaptionRef = {:id}', { id: captionId })
  );
  const referencingClipIds = refs.items.map((c) => c.id);

  if (referencingClipIds.length > 0 && !opts.force) {
    throw new Error(
      `Caption ${captionId} is used by ${referencingClipIds.length} timeline clip(s) ` +
        `(${referencingClipIds.join(', ')}). Remove those clips first, or pass ` +
        '--force to delete anyway (leaves dangling refs).'
    );
  }

  await mutator.delete(captionId);
  return { caption, referencingClipIds };
}
