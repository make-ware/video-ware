import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import {
  FileType,
  type File as PbFile,
  type TypedPocketBase,
} from '@project/shared';
import { apiFetch } from './http.js';

/**
 * Reading bytes out of the Files collection.
 *
 * Every `vw` command that downloads media bytes goes through here, and the
 * allow-list below is why: `vw` reads worker-generated proxy material only —
 * filmstrips, proxies, thumbnails, sprites, extracted audio, renders — never
 * the untouched source upload. `FileType.ORIGINAL` is deliberately absent, and
 * a future FileType is refused until someone adds it on purpose.
 */
export const DERIVED_FILE_TYPES: readonly FileType[] = [
  FileType.PROXY,
  FileType.THUMBNAIL,
  FileType.SPRITE,
  FileType.FILMSTRIP,
  FileType.AUDIO,
  FileType.WAVEFORM,
  FileType.RENDER,
  FileType.LABELS_JSON,
];

/** Refuse to read bytes from anything but derived material. */
export function assertDerivedFile(file: Pick<PbFile, 'id' | 'fileType'>): void {
  const type = String(file.fileType);
  if (type === String(FileType.ORIGINAL)) {
    throw new Error(
      `File ${file.id} is fileType "original" — vw reads derived proxy ` +
        `material only (${DERIVED_FILE_TYPES.join(', ')}), never the source upload.`
    );
  }
  if (!(DERIVED_FILE_TYPES as readonly string[]).includes(type)) {
    throw new Error(
      `File ${file.id} is fileType "${type}", not one of: ` +
        `${DERIVED_FILE_TYPES.join(', ')}.`
    );
  }
}

/**
 * Direct download URL for a PocketBase-hosted File. The Files collection's
 * `file` field is not `protected`, so no file token is needed — the same
 * reason `downloadRender` gets away with a bare fetch.
 */
export function pbFileUrl(pb: TypedPocketBase, file: PbFile): string {
  if (!file.file) {
    throw new Error(
      `File ${file.id} is not hosted in PocketBase (fileSource ` +
        `"${String(file.fileSource)}") — vw cannot download it directly.`
    );
  }
  return pb.files.getURL(file, file.file);
}

/**
 * Whole-buffer download of a derived File. `subject` names the thing being
 * fetched in failure messages (e.g. "filmstrip segment 2 of media abc").
 *
 * Mirrors `downloadRender` in lib/render.ts, which predates this module and
 * keeps its own copy so its render-specific error text stays put.
 */
export async function downloadDerivedFile(
  pb: TypedPocketBase,
  file: PbFile,
  subject: string
): Promise<Buffer> {
  assertDerivedFile(file);
  const res = await apiFetch(pbFileUrl(pb, file));
  if (!res.ok) {
    throw new Error(
      `Download failed for ${subject}: ${res.status} ${res.statusText}`
    );
  }
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Stream a derived File's bytes straight to `destPath`, returning the byte
 * count written.
 *
 * Unlike `downloadDerivedFile`, nothing is held in memory — a 720p proxy of a
 * long source runs to hundreds of megabytes, and buffering one only to write
 * it out again is the difference between a CLI that works on any media and one
 * that dies on the big ones.
 *
 * A transfer that fails part-way removes the partial file: whoever asked for
 * these bytes is about to hand them to ffprobe or a decoder, and a truncated
 * file that merely *looks* complete is worse than no file at all.
 */
export async function streamDerivedFile(
  pb: TypedPocketBase,
  file: PbFile,
  destPath: string,
  subject: string,
  onProgress?: (bytesWritten: number) => void
): Promise<number> {
  assertDerivedFile(file);
  const res = await apiFetch(pbFileUrl(pb, file));
  if (!res.ok) {
    throw new Error(
      `Download failed for ${subject}: ${res.status} ${res.statusText}`
    );
  }
  if (!res.body) {
    throw new Error(`Download for ${subject} returned no body.`);
  }

  let written = 0;
  const body = res.body as unknown as AsyncIterable<Uint8Array>;
  async function* counted(): AsyncGenerator<Uint8Array> {
    for await (const chunk of body) {
      written += chunk.byteLength;
      onProgress?.(written);
      yield chunk;
    }
  }

  try {
    await pipeline(counted(), createWriteStream(destPath));
  } catch (err) {
    await rm(destPath, { force: true }).catch(() => undefined);
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Download failed for ${subject} after ${written} byte(s): ${message}`
    );
  }
  return written;
}
