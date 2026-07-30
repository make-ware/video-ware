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
