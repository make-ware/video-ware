import type { Command } from 'commander';
import { extractFrame, frameSummaryLines } from '../lib/frame.js';
import { parseSeconds, withJsonOption } from '../lib/options.js';
import { info, success, warn } from '../lib/output.js';
import { handleError, requireClient } from '../lib/run.js';

export function registerFrameCommands(program: Command): void {
  const frame = program
    .command('frame')
    .description(
      'Write one still JPEG from a media, media clip, or timeline clip ' +
        '(cut from the filmstrip previews — ~320px wide, sampled at 1 fps)'
    )
    .option(
      '-m, --media <id>',
      'source media id (--at is absolute media seconds)'
    )
    .option(
      '-c, --clip <mediaClipId>',
      "media clip id (--at is seconds from the clip's first played frame)"
    )
    .option(
      '--timeline-clip <id>',
      "timeline clip id (--at is seconds from the clip's first played frame)"
    )
    .option(
      '--at <seconds>',
      'time to grab: absolute media seconds with -m; seconds from the ' +
        "clip's first played frame (cut gaps skipped) with -c/--timeline-clip",
      parseSeconds,
      0
    )
    .option(
      '-o, --out <path>',
      'output file, or a directory to write the default name into ' +
        '(default: frame-<mediaId>-<t>s.jpg in the current directory)'
    )
    .option('--base64', 'print the frame as base64 instead of writing a file')
    .option('--force', 'overwrite the output file if it already exists');

  withJsonOption(frame).action(async (opts) => {
    try {
      const pb = await requireClient();
      const result = await extractFrame(pb, {
        media: opts.media,
        clip: opts.clip,
        timelineClip: opts.timelineClip,
        at: opts.at,
        out: opts.out,
        base64: opts.base64,
        force: opts.force,
      });

      // Warnings go to stderr so both --json and --base64 keep stdout clean.
      for (const message of result.warnings) warn(message);

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      if (opts.base64) {
        // stdout is the payload and nothing else.
        console.log(result.base64);
        return;
      }

      const [headline, ...rest] = frameSummaryLines(result);
      success(headline);
      for (const line of rest) info(line);
    } catch (err) {
      handleError(err);
    }
  });
}
