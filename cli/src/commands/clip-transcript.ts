import type { Command } from 'commander';
import { handleError, requireClient } from '../lib/run.js';
import {
  mediaClipTranscript,
  timelineClipTranscript,
  type ClipTranscriptResult,
  type TranscriptLabelType,
} from '../lib/clip-transcript.js';
import { withJsonOption } from '../lib/options.js';
import { info, printRecord, range, secs, warn } from '../lib/output.js';

/**
 * `transcript` subcommand, registered identically under `vw media clip …`
 * and `vw timeline clips …`: what does this clip actually say — words inside
 * cut gaps trimmed out, so the text you read is the text the cut plays.
 */

/** `-w` is accepted on every clip command so agents can pass it uniformly. */
const workspaceOption = (cmd: Command): Command =>
  cmd.option(
    '-w, --workspace <id>',
    'workspace id (accepted for flag consistency; clips are addressed by id)'
  );

function parseTranscriptType(value: string): TranscriptLabelType {
  if (value !== 'speaker' && value !== 'speech') {
    throw new Error(`Invalid --type "${value}" — use speaker or speech.`);
  }
  return value;
}

function transcriptCommand(parent: Command): Command {
  return withJsonOption(
    workspaceOption(
      parent
        .command('transcript <clipId>')
        .description(
          "What the clip actually says: transcript trimmed to the clip's " +
            'edit list at word level (cut gaps omitted)'
        )
        .option(
          '--type <speaker|speech>',
          'force the label source (default: speaker labels, falling back to speech)',
          parseTranscriptType
        )
        .option(
          '--full-text',
          'print only the flowing speaker-labeled text (audit mode)'
        )
        .option('--words', 'include per-word timing arrays in --json output')
    )
  );
}

/** "[src 2.10–6.60s | clip 0.30–4.80s | tl 30.30–34.80s]" prefix. */
function partPrefix(
  part: { sourceStart: number; sourceEnd: number },
  clipStart: number,
  clipEnd: number,
  timelineStart?: number,
  timelineEnd?: number
): string {
  const pieces = [
    `src ${range(part.sourceStart, part.sourceEnd)}`,
    `clip ${range(clipStart, clipEnd)}`,
    ...(timelineStart !== undefined && timelineEnd !== undefined
      ? [`tl ${range(timelineStart, timelineEnd)}`]
      : []),
  ];
  return `[${pieces.join(' | ')}]`;
}

function reportTranscript(
  result: ClipTranscriptResult,
  opts: { json?: boolean; fullText?: boolean }
): void {
  if (opts.json) {
    printRecord(result, [], true);
    return;
  }

  const estimated = result.utterances.filter((u) => u.estimatedTimings).length;
  if (estimated > 0) {
    warn(
      `word timings estimated for ${estimated} utterance(s) — cut filtering is approximate`
    );
  }

  if (opts.fullText) {
    if (result.text) info(result.text);
    else info('(no transcript content overlaps this clip)');
    return;
  }

  const sourceLabel = result.labelType
    ? `${result.labelType} labels`
    : 'no labels';
  info(
    `Clip ${result.clipId} — transcript from ${sourceLabel} ` +
      `(${result.segments.length} segment(s), ` +
      `effective ${secs(result.times.effective.duration)}, ` +
      `span ${range(result.times.source.start, result.times.source.end)} of media ${result.mediaId})`
  );
  if (result.placement) {
    info(
      `  timeline: ${range(result.placement.timelineStart, result.placement.timelineEnd)} ` +
        `(track layer ${result.placement.layer}) — edit list source: ${result.editListSource}`
    );
  } else {
    info(`  edit list source: ${result.editListSource}`);
  }

  if (result.labelType === null) {
    info(
      "  no speaker/speech labels overlap this clip's played content — " +
        `queue detection with \`vw job label -m ${result.mediaId} -t speaker,speech\``
    );
    return;
  }
  if (result.utterances.length === 0) {
    info('  (every overlapping utterance falls inside cut gaps)');
  }

  // Flatten parts in clip-time order; a cut line marks each edit-list jump.
  const flat = result.utterances
    .flatMap((u) => u.parts.map((part) => ({ u, part })))
    .sort((a, b) => a.part.clipStart - b.part.clipStart);
  let prevSegment: number | undefined;
  for (const { u, part } of flat) {
    if (prevSegment !== undefined && part.segmentIndex > prevSegment) {
      const removed = result.gaps
        .filter(
          (g) =>
            g.afterIndex >= prevSegment! && g.afterIndex < part.segmentIndex
        )
        .reduce((sum, g) => sum + g.seconds, 0);
      if (removed > 0) {
        info(`  ── cut: ${secs(removed)} of source removed ──`);
      }
    }
    prevSegment = Math.max(prevSegment ?? part.segmentIndex, part.segmentIndex);
    const speaker = u.speaker ? `${u.speaker.label}: ` : '';
    info(
      `  ${partPrefix(part, part.clipStart, part.clipEnd, part.timelineStart, part.timelineEnd)} ${speaker}${part.text}`
    );
  }

  const { droppedUtterances, omittedWords } = result.totals;
  if (droppedUtterances > 0 || omittedWords > 0) {
    const hidden =
      droppedUtterances > 0
        ? `${droppedUtterances} utterance(s) hidden entirely by cuts; `
        : '';
    info(
      `  (${hidden}${omittedWords} word(s) omitted — \`segments\` shows the gaps)`
    );
  }
}

async function runTranscript(
  clipId: string,
  opts: {
    json?: boolean;
    fullText?: boolean;
    words?: boolean;
    type?: TranscriptLabelType;
    timeline?: string;
  },
  domain: 'media' | 'timeline'
): Promise<void> {
  const pb = await requireClient();
  const shared = { type: opts.type, words: opts.words };
  const result =
    domain === 'media'
      ? await mediaClipTranscript(pb, clipId, shared)
      : await timelineClipTranscript(pb, clipId, {
          ...shared,
          timelineId: opts.timeline,
        });
  reportTranscript(result, opts);
}

/** Register `transcript` under `vw media clip`. */
export function registerMediaClipTranscriptCommand(clip: Command): void {
  transcriptCommand(clip).action(async (clipId: string, opts) => {
    try {
      await runTranscript(clipId, opts, 'media');
    } catch (err) {
      handleError(err);
    }
  });
}

/** Register `transcript` under `vw timeline clips`. */
export function registerTimelineClipTranscriptCommand(clips: Command): void {
  transcriptCommand(clips)
    .option('-t, --timeline <id>', 'timeline id (validated when passed)')
    .action(async (clipId: string, opts) => {
      try {
        await runTranscript(clipId, opts, 'timeline');
      } catch (err) {
        handleError(err);
      }
    });
}
