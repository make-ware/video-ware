import { extname } from 'node:path';
import {
  FileMutator,
  FileStatus,
  FileType,
  type File as PbFile,
  type FileMetadata,
  type TypedPocketBase,
} from '@project/shared';
import { pbFileUrl, streamDerivedFile } from './files.js';
import type { TranscodeAsset } from './job.js';
import {
  assertWritableOutPath,
  isExistingDirectory,
  resolveOutPath,
} from './out-path.js';
import { formatBytes } from './output.js';
import { mediaLabel, requireMedia, type MediaWithUpload } from './select.js';

/**
 * `vw media download` — write the derived preview files the transcode pipeline
 * already produced to the local filesystem, so ffprobe, a waveform tool, a
 * transcription model, or an agent's own analysis can read the bytes instead of
 * only the records describing them.
 *
 * Preview material only. The allow-list in lib/files.ts refuses the source
 * upload, and every kind below is something the worker generated — which is
 * also the caveat worth repeating to whoever reads the output: the proxy is
 * 720p h264 and the extracted audio is a 128k mixdown, so measurements taken
 * here describe the preview, not the master.
 */

/** The single-relation preview files a Media carries. */
export type PreviewKind = 'proxy' | 'audio' | 'thumbnail' | 'sprite';

/** The Media relation fields that hold one preview File each. */
type PreviewRef =
  'proxyFileRef' | 'audioFileRef' | 'thumbnailFileRef' | 'spriteFileRef';

export interface PreviewKindSpec {
  /** The Media relation field holding this preview's File id. */
  ref: PreviewRef;
  /** What the referenced File's own `fileType` must be. */
  fileType: FileType;
  /** One-line `--help` text; also names the kind in failure messages. */
  description: string;
  /** The `vw job transcode -a <asset>` that (re)generates it. */
  asset: TranscodeAsset;
  /** Extension for the default output name when the File record has none. */
  extension: string;
}

/**
 * Every downloadable preview, keyed by its flag name.
 *
 * `filmstrip` is deliberately absent: it is a multi-file relation whose sheets
 * are grids of ~320px tiles, useful only once cut apart — which is what
 * `vw frame` does. `render` and `labels_json` are absent for the same
 * "something else already serves it" reason: `vw timeline render --download`
 * and `vw label`.
 */
export const PREVIEW_KINDS = {
  proxy: {
    ref: 'proxyFileRef',
    fileType: FileType.PROXY,
    description: 'the web-playable video proxy (h264, 720p)',
    asset: 'proxy',
    extension: '.mp4',
  },
  audio: {
    ref: 'audioFileRef',
    fileType: FileType.AUDIO,
    description: 'the extracted audio-only track (128k mixdown)',
    asset: 'audio',
    extension: '.mp3',
  },
  thumbnail: {
    ref: 'thumbnailFileRef',
    fileType: FileType.THUMBNAIL,
    description: 'the single still thumbnail (JPEG, 640x360)',
    asset: 'thumbnail',
    extension: '.jpg',
  },
  sprite: {
    ref: 'spriteFileRef',
    fileType: FileType.SPRITE,
    description: 'the scrub-preview sprite sheet (JPEG grid of tiles)',
    asset: 'sprite',
    extension: '.jpg',
  },
} as const satisfies Record<PreviewKind, PreviewKindSpec>;

/** Every preview kind, in flag order. */
export const PREVIEW_KIND_NAMES = Object.keys(PREVIEW_KINDS) as PreviewKind[];

/** The `--proxy`/`--audio`/… flags, as a commander-style option map. */
export type PreviewKindFlags = Partial<Record<PreviewKind, boolean>>;

/**
 * Exactly one kind flag, resolved before any network call. Downloading a whole
 * file is slow enough that "which one did you mean" must not be answered by
 * guessing.
 */
export function selectPreviewKind(opts: PreviewKindFlags): PreviewKind {
  const given = PREVIEW_KIND_NAMES.filter((kind) => opts[kind]);
  if (given.length === 0) {
    throw new Error(
      `Pass one of ${PREVIEW_KIND_NAMES.map((k) => `--${k}`).join(', ')}.`
    );
  }
  if (given.length > 1) {
    throw new Error(
      `--${given[0]} and --${given[1]} are mutually exclusive — one preview per run.`
    );
  }
  return given[0];
}

/** Which preview kinds this media actually has a File reference for. */
export function availablePreviewKinds(
  media: Pick<MediaWithUpload, PreviewRef>
): PreviewKind[] {
  return PREVIEW_KIND_NAMES.filter((kind) =>
    Boolean(media[PREVIEW_KINDS[kind].ref])
  );
}

/**
 * The "there is no such preview" message. Says what the media *does* have and
 * how to generate what it doesn't, so the next command is obvious without a
 * second round-trip.
 */
export function missingPreviewMessage(
  media: Pick<MediaWithUpload, 'id' | PreviewRef>,
  kind: PreviewKind
): string {
  const have = availablePreviewKinds(media);
  const also =
    have.length > 0
      ? ` It does have: ${have.map((k) => `--${k}`).join(', ')}.`
      : '';
  return (
    `Media ${media.id} has no ${kind} file.${also} Generate one with ` +
    `\`vw job transcode -m ${media.id} -a ${PREVIEW_KINDS[kind].asset}\`, then ` +
    're-run (a running worker must pick the task up).'
  );
}

/**
 * Extension for the output name, taken from what the producer actually wrote:
 * the File's `name` (the worker stores `proxy.mp4`, `audio.mp3`, …), then the
 * stored blob's own name, then the kind's default. Guessing from
 * `meta.mimeType` is avoided on purpose — the audio step picks its container
 * at encode time, and the file name is the one place that choice is recorded
 * verbatim.
 */
export function previewExtension(
  kind: PreviewKind,
  file: Pick<PbFile, 'name' | 'file'>
): string {
  for (const candidate of [file.name, file.file]) {
    const ext = candidate ? extname(candidate) : '';
    if (/^\.[A-Za-z0-9]{1,8}$/.test(ext)) return ext.toLowerCase();
  }
  return PREVIEW_KINDS[kind].extension;
}

/** Default output name — deterministic, and safe on every filesystem. */
export function defaultPreviewFilename(
  mediaId: string,
  kind: PreviewKind,
  file: Pick<PbFile, 'name' | 'file'>
): string {
  return `${kind}-${mediaId}${previewExtension(kind, file)}`;
}

/**
 * The File record behind one of a media's previews.
 *
 * `MediaMutator` expands proxy/thumbnail/sprite by default, so those cost no
 * extra request; `audioFileRef` is not in that expand and always needs one.
 * Every guard here is about failing with the reason rather than handing back
 * bytes that are not what was asked for.
 */
export async function resolvePreviewFile(
  pb: TypedPocketBase,
  media: MediaWithUpload,
  kind: PreviewKind
): Promise<PbFile> {
  const spec = PREVIEW_KINDS[kind];
  const fileId = media[spec.ref];
  if (!fileId) {
    throw new Error(missingPreviewMessage(media, kind));
  }

  const expanded = (media as { expand?: Record<string, PbFile | undefined> })
    .expand?.[spec.ref];
  const file = expanded ?? (await new FileMutator(pb).getById(fileId));
  if (!file) {
    throw new Error(
      `Media ${media.id} points at ${kind} File ${fileId}, which no longer ` +
        `exists — regenerate it with \`vw job transcode -m ${media.id} ` +
        `-a ${spec.asset}\`.`
    );
  }
  if (String(file.fileType) !== String(spec.fileType)) {
    throw new Error(
      `File ${file.id} is referenced as this media's ${kind} but is fileType ` +
        `"${String(file.fileType)}".`
    );
  }
  if (String(file.fileStatus) !== String(FileStatus.AVAILABLE)) {
    throw new Error(
      `${kind} File ${file.id} is fileStatus "${String(file.fileStatus)}", not ` +
        `"${FileStatus.AVAILABLE}" — its bytes are not ready. Regenerate it ` +
        `with \`vw job transcode -m ${media.id} -a ${spec.asset}\`.`
    );
  }
  return file;
}

export interface DownloadPreviewOptions {
  mediaId: string;
  kind: PreviewKind;
  /** Output file, or a directory to write the default name into. */
  out?: string;
  /** Overwrite an existing output file. */
  force?: boolean;
  /** Resolve and report the download URL, writing nothing. */
  urlOnly?: boolean;
  /** Called with the running byte count as the transfer proceeds. */
  onProgress?: (bytesWritten: number, expectedBytes: number) => void;
}

export interface PreviewDownloadResult {
  mediaId: string;
  /** The media's display name (label, else source file name, else id). */
  mediaName: string;
  kind: PreviewKind;
  file: {
    id: string;
    name: string;
    fileType: string;
    /** Size recorded on the File record. */
    size: number;
    /** Measured facts the producer stored (duration, codec, geometry, …). */
    meta: FileMetadata | undefined;
  };
  /** Direct download URL — usable without a file token (the field is public). */
  url: string;
  /** Where the bytes landed; null under `urlOnly`. */
  path: string | null;
  /** Bytes actually written; null under `urlOnly`. */
  bytes: number | null;
  /** Non-fatal notes for the caller to surface on stderr. */
  warnings: string[];
}

/** Resolve the preview, then stream it to disk (or just report its URL). */
export async function downloadMediaPreview(
  pb: TypedPocketBase,
  opts: DownloadPreviewOptions
): Promise<PreviewDownloadResult> {
  if (opts.urlOnly && (opts.out || opts.force)) {
    throw new Error('--url only prints the download URL — drop -o/--force.');
  }

  const media = await requireMedia(pb, opts.mediaId);
  const file = await resolvePreviewFile(pb, media, opts.kind);
  const url = pbFileUrl(pb, file);
  const warnings: string[] = [];

  const base = {
    mediaId: media.id,
    mediaName: mediaLabel(media),
    kind: opts.kind,
    file: {
      id: file.id,
      name: file.name,
      fileType: String(file.fileType),
      size: file.size,
      meta: file.meta,
    },
    url,
  };

  if (opts.urlOnly) {
    return { ...base, path: null, bytes: null, warnings };
  }

  // Resolved and cleared before a byte is fetched, so a bad path or an
  // unforced overwrite costs nothing.
  const path = resolveOutPath(
    opts.out,
    defaultPreviewFilename(media.id, opts.kind, file),
    process.cwd(),
    isExistingDirectory
  );
  assertWritableOutPath(path, opts.force);

  const subject = `${opts.kind} of media ${media.id} (File ${file.id})`;
  const bytes = await streamDerivedFile(pb, file, path, subject, (written) =>
    opts.onProgress?.(written, file.size)
  );

  // The record's `size` is what the producer measured on upload; a mismatch
  // means the two disagree, and the file on disk is the one about to be
  // analysed — say so rather than let a silent short read look like a clean run.
  if (file.size > 0 && bytes !== file.size) {
    warnings.push(
      `Wrote ${bytes} byte(s) but File ${file.id} records a size of ` +
        `${file.size} — verify the download before relying on it.`
    );
  }

  return { ...base, path, bytes, warnings };
}

/**
 * Human-readable summary lines for a download result (stdout). The second line
 * is the measured facts the producer recorded — enough to know what was
 * downloaded without probing it first.
 */
export function previewSummaryLines(result: PreviewDownloadResult): string[] {
  const lines: string[] = [];
  lines.push(
    `${result.kind} of media ${result.mediaId} → ${result.path ?? result.url}`
  );

  const meta = result.file.meta;
  const facts: string[] = [
    `File ${result.file.id}`,
    formatBytes(result.bytes ?? result.file.size),
  ];
  if (meta?.duration !== undefined) facts.push(`${meta.duration.toFixed(2)}s`);
  if (meta?.width && meta?.height) facts.push(`${meta.width}x${meta.height}`);
  if (meta?.fps !== undefined) facts.push(`${meta.fps} fps`);
  if (meta?.codec) facts.push(meta.codec);
  if (meta?.channels !== undefined) facts.push(`${meta.channels} ch`);
  if (meta?.sampleRate !== undefined) facts.push(`${meta.sampleRate} Hz`);
  lines.push(`  ${result.mediaName} · ${facts.join(' · ')}`);

  // With a path, the URL is the extra fact; with --url it is already line one.
  if (result.path) lines.push(`  ${result.url}`);
  return lines;
}
