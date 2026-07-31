import type { Command } from 'commander';
import {
  PREVIEW_KINDS,
  PREVIEW_KIND_NAMES,
  downloadMediaPreview,
  previewSummaryLines,
  selectPreviewKind,
} from '../lib/download.js';
import { withJsonOption } from '../lib/options.js';
import { formatBytes, info, success, warn } from '../lib/output.js';
import { handleError, requireClient } from '../lib/run.js';

/**
 * Progress on stderr, so `--json` and any redirect of stdout stay clean, and
 * only when stderr is a terminal — a piped or captured run gets nothing rather
 * than a log full of carriage returns. A 720p proxy of a long source takes long
 * enough that silence reads as a hang.
 */
function progressReporter(): (written: number, expected: number) => void {
  if (!process.stderr.isTTY) return () => undefined;
  let lastAt = 0;
  return (written, expected) => {
    const now = Date.now();
    if (written < expected && now - lastAt < 250) return;
    lastAt = now;
    const of = expected > 0 ? ` / ${formatBytes(expected)}` : '';
    const pct =
      expected > 0
        ? ` (${Math.min(100, Math.round((written / expected) * 100))}%)`
        : '';
    process.stderr.write(`\r  ${formatBytes(written)}${of}${pct}    `);
  };
}

/** Clear the progress line so the summary starts on a clean row. */
function clearProgress(): void {
  if (process.stderr.isTTY) process.stderr.write('\r\u001b[K');
}

/**
 * `vw media download` — pull one of a media's derived preview files down to
 * disk. Registered on the `media` group by `registerMediaCommands`.
 */
export function registerMediaDownloadCommand(media: Command): void {
  const download = media
    .command('download <mediaId>')
    .alias('dl')
    .description(
      'Download one of a media’s derived preview files (proxy video, ' +
        'extracted audio, thumbnail, sprite sheet) for local analysis'
    );

  // One flag per kind, driven by PREVIEW_KINDS so a new preview is one entry.
  for (const kind of PREVIEW_KIND_NAMES) {
    download.option(`--${kind}`, PREVIEW_KINDS[kind].description);
  }

  download
    .option(
      '-o, --out <path>',
      'output file, or a directory to write the default name into ' +
        '(default: <kind>-<mediaId>.<ext> in the current directory)'
    )
    .option('--force', 'overwrite the output file if it already exists')
    .option('--url', 'print the download URL instead of downloading')
    .addHelpText(
      'after',
      `
Previews only:
  These are the assets the transcode pipeline generated, never the source
  upload — the proxy is 720p h264 and the audio is a 128k mixdown, so
  measurements taken from them describe the preview, not the master. When a
  media has no such file yet, the error names the \`vw job transcode\` that
  generates it.

Examples:
  vw media download <mediaId> --proxy -o ./work/
  vw media download <mediaId> --audio -o speech.mp3 && ffprobe speech.mp3
  vw media download <mediaId> --proxy --url`
    );

  withJsonOption(download).action(async (mediaId: string, opts) => {
    try {
      // Before any network call: a missing or doubled kind flag is a usage
      // error, and --json/--url combinations are checked in the lib.
      const kind = selectPreviewKind(opts);
      const pb = await requireClient();

      const result = await downloadMediaPreview(pb, {
        mediaId,
        kind,
        out: opts.out,
        force: opts.force,
        urlOnly: opts.url,
        onProgress: opts.json ? undefined : progressReporter(),
      });
      clearProgress();

      // Warnings go to stderr so --json keeps stdout parseable.
      for (const message of result.warnings) warn(message);

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      if (opts.url) {
        // stdout is the URL and nothing else, so it pipes into curl.
        console.log(result.url);
        return;
      }

      const [headline, ...rest] = previewSummaryLines(result);
      success(headline);
      for (const line of rest) info(line);
    } catch (err) {
      clearProgress();
      handleError(err);
    }
  });
}
