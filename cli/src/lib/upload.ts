import { open, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { FileHandle } from 'node:fs/promises';
import {
  MediaMutator,
  MediaType,
  TaskMutator,
  TaskStatus,
  UploadMutator,
  UploadStatus,
  type Media,
  type TypedPocketBase,
  type Upload,
} from '@project/shared';
import { loadConfig } from './config.js';
import { resolveUrl } from './pocketbase.js';

/**
 * Uploads mirror the webapp's chunked uploader: the file is PUT to the
 * Next.js `/api-next/uploads/upload` route in sequential chunks sized under
 * Cloudflare's ~100MB request-body limit, so proxied deployments work. On
 * the last chunk the route flips the Upload record to `uploaded`, which
 * triggers ingest (a PocketBase hook queues a `full_ingest` task and the
 * worker creates the Media and transcodes).
 */
export const DEFAULT_CHUNK_SIZE = 100 * 1024 * 1024;

/** Same ceiling the webapp enforces (webapp/src/constants/upload.ts). */
export const MAX_UPLOAD_SIZE = 24 * 1024 * 1024 * 1024;

export const UPLOAD_ROUTE_PATH = '/api-next/uploads/upload';
export const REPLACE_ROUTE_PATH = '/api-next/uploads/replace';

/**
 * Extensions the ingest pipeline understands, by the media type the worker
 * would assign them. The worker detects the type from the extension, so an
 * unknown one would be misclassified as video rather than rejected
 * server-side.
 */
const UPLOAD_EXTENSIONS_BY_TYPE: Record<MediaType, readonly string[]> = {
  [MediaType.VIDEO]: ['mp4', 'webm', 'mov', 'avi', 'mkv'],
  [MediaType.AUDIO]: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'],
  [MediaType.IMAGE]: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
};

export const ALLOWED_UPLOAD_EXTENSIONS = new Set(
  Object.values(UPLOAD_EXTENSIONS_BY_TYPE).flat()
);

/** Media type the ingest pipeline would assign a file, from its extension. */
export function mediaTypeForFile(fileName: string): MediaType | undefined {
  const extension = extname(fileName).slice(1).toLowerCase();
  const entries = Object.entries(UPLOAD_EXTENSIONS_BY_TYPE) as [
    MediaType,
    readonly string[],
  ][];
  return entries.find(([, extensions]) => extensions.includes(extension))?.[0];
}

/**
 * Resolve the webapp origin serving `/api-next`: explicit override → cached
 * config `appUrl` → env VW_APP_URL → derived from the PocketBase URL. In the
 * monolith deployment one origin serves both `/api/` (PocketBase) and
 * `/api-next/` (Next.js), so the PB URL is the right default; in split local
 * dev (PB on :8090) the webapp conventionally runs on :3000.
 */
export function resolveAppUrl(override?: string): string {
  const strip = (url: string): string => url.replace(/\/+$/, '');
  if (override) return strip(override);
  const cfg = loadConfig();
  if (cfg.appUrl) return strip(cfg.appUrl);
  if (process.env.VW_APP_URL) return strip(process.env.VW_APP_URL);

  const pbUrl = strip(resolveUrl());
  try {
    const url = new URL(pbUrl);
    if (
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1') &&
      url.port === '8090'
    ) {
      url.port = '3000';
      return strip(url.toString());
    }
  } catch {
    // Not a parseable URL — use it verbatim and let the request fail loudly.
  }
  return pbUrl;
}

export interface ChunkSpec {
  index: number;
  start: number;
  length: number;
}

/** Split a file size into sequential chunk specs (last chunk may be short). */
export function chunkPlan(fileSize: number, chunkSize: number): ChunkSpec[] {
  const totalChunks = Math.ceil(fileSize / chunkSize);
  const chunks: ChunkSpec[] = [];
  for (let index = 0; index < totalChunks; index++) {
    const start = index * chunkSize;
    chunks.push({
      index,
      start,
      length: Math.min(chunkSize, fileSize - start),
    });
  }
  return chunks;
}

/** Format a byte count for progress lines (e.g. "1.2 GB"). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const rounded =
    unit === 0 || value >= 10 ? String(Math.round(value)) : value.toFixed(1);
  return `${rounded} ${units[unit]}`;
}

export interface ValidatedUploadFile {
  name: string;
  size: number;
}

/**
 * Validate a local file for upload: it must exist, be non-empty (the chunk
 * protocol cannot represent zero chunks), stay under the size ceiling, and
 * carry an extension the ingest pipeline understands.
 */
export async function validateUploadFile(
  filePath: string
): Promise<ValidatedUploadFile> {
  let stats;
  try {
    stats = await stat(filePath);
  } catch {
    throw new Error(`File not found: ${filePath}`);
  }
  if (!stats.isFile()) {
    throw new Error(`Not a file: ${filePath}`);
  }
  if (stats.size === 0) {
    throw new Error(`File is empty: ${filePath}`);
  }
  if (stats.size > MAX_UPLOAD_SIZE) {
    throw new Error(
      `File exceeds the ${formatBytes(MAX_UPLOAD_SIZE)} upload limit: ` +
        `${filePath} (${formatBytes(stats.size)})`
    );
  }
  const name = basename(filePath);
  const extension = extname(name).slice(1).toLowerCase();
  if (!extension || !ALLOWED_UPLOAD_EXTENSIONS.has(extension)) {
    throw new Error(
      `Unsupported file type "${name}" — supported extensions: ` +
        [...ALLOWED_UPLOAD_EXTENSIONS].join(', ')
    );
  }
  return { name, size: stats.size };
}

export interface UploadProgress {
  chunkIndex: number;
  totalChunks: number;
  bytesUploaded: number;
  totalBytes: number;
}

export interface UploadFileOptions {
  filePath: string;
  workspaceId: string;
  /** Webapp origin serving `/api-next` (see resolveAppUrl). */
  appUrl: string;
  directoryId?: string;
  chunkSize?: number;
  /** Retries per chunk on network errors / 5xx (4xx fails fast). */
  maxRetries?: number;
  /** Base for the 2^attempt exponential backoff; tests pass 0. */
  backoffBaseMs?: number;
  /** Per-chunk request timeout. */
  timeoutMs?: number;
  /** Fires once the Upload record exists (e.g. to enable cancellation). */
  onCreated?: (upload: Upload) => void;
  onProgress?: (progress: UploadProgress) => void;
}

/** A failed chunk request; `retryable` says whether another attempt helps. */
class ChunkRequestError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'ChunkRequestError';
    this.retryable = retryable;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Read one chunk into memory via positioned reads (guards short reads). */
async function readChunk(
  fh: FileHandle,
  spec: ChunkSpec
): Promise<Uint8Array<ArrayBuffer>> {
  const buffer = new Uint8Array(spec.length);
  let offset = 0;
  while (offset < spec.length) {
    const { bytesRead } = await fh.read(
      buffer,
      offset,
      spec.length - offset,
      spec.start + offset
    );
    if (bytesRead === 0) {
      throw new Error('Unexpected end of file — did the file change?');
    }
    offset += bytesRead;
  }
  return buffer;
}

interface ChunkResponse {
  complete: boolean;
  upload?: Upload;
}

async function putChunk(
  pb: TypedPocketBase,
  url: string,
  params: {
    uploadId: string;
    workspaceId: string;
    userId: string;
    fileName: string;
    chunk: ChunkSpec;
    totalChunks: number;
    buffer: Uint8Array<ArrayBuffer>;
    directoryId?: string;
    timeoutMs: number;
  }
): Promise<ChunkResponse> {
  // Read the token per attempt so a mid-upload refresh is picked up.
  const token = pb.authStore.token;
  if (!token) {
    throw new ChunkRequestError(
      'User must be authenticated to upload files',
      false
    );
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'x-upload-id': params.uploadId,
    'x-workspace-id': params.workspaceId,
    'x-user-id': params.userId,
    'x-file-name': params.fileName,
    'x-chunk-index': String(params.chunk.index),
    'x-total-chunks': String(params.totalChunks),
    'x-chunk-size': String(params.buffer.length),
  };
  if (params.directoryId) {
    headers['x-directory-id'] = params.directoryId;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'PUT',
      headers,
      body: params.buffer,
      signal: AbortSignal.timeout(params.timeoutMs),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError';
    throw new ChunkRequestError(
      timedOut
        ? `chunk ${params.chunk.index + 1} timed out`
        : `network error (${err instanceof Error ? err.message : String(err)}) — ` +
            `is the webapp reachable at ${url}?`,
      true
    );
  }

  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    complete?: boolean;
    upload?: Upload;
  };

  if (!res.ok) {
    // 4xx (auth/validation) won't self-heal; 5xx might.
    throw new ChunkRequestError(
      body.error ?? `HTTP ${res.status}`,
      res.status >= 500
    );
  }
  return { complete: body.complete === true, upload: body.upload };
}

/**
 * Drive the sequential chunk protocol shared by upload and replace: read each
 * chunk, PUT it (with per-chunk retries), report progress, and return the
 * response that confirmed completion — the routes report `complete` on the
 * last chunk, or early when a retried request finds the work already done.
 */
async function driveChunkProtocol(
  pb: TypedPocketBase,
  url: string,
  fh: FileHandle,
  params: {
    uploadId: string;
    workspaceId: string;
    userId: string;
    fileName: string;
    fileSize: number;
    chunks: ChunkSpec[];
    directoryId?: string;
    maxRetries: number;
    backoffBaseMs: number;
    timeoutMs: number;
    onProgress?: (progress: UploadProgress) => void;
  }
): Promise<ChunkResponse> {
  let bytesUploaded = 0;
  for (const chunk of params.chunks) {
    const buffer = await readChunk(fh, chunk);
    for (let attempt = 0; ; attempt++) {
      try {
        const result = await putChunk(pb, url, {
          uploadId: params.uploadId,
          workspaceId: params.workspaceId,
          userId: params.userId,
          fileName: params.fileName,
          chunk,
          totalChunks: params.chunks.length,
          buffer,
          directoryId: params.directoryId,
          timeoutMs: params.timeoutMs,
        });
        bytesUploaded += chunk.length;
        params.onProgress?.({
          chunkIndex: chunk.index,
          totalChunks: params.chunks.length,
          bytesUploaded,
          totalBytes: params.fileSize,
        });
        if (result.complete) {
          return result;
        }
        break;
      } catch (err) {
        const retryable = !(err instanceof ChunkRequestError) || err.retryable;
        if (!retryable || attempt >= params.maxRetries) {
          throw new Error(
            `Failed to upload chunk ${chunk.index + 1}/${params.chunks.length}: ` +
              (err instanceof Error ? err.message : String(err))
          );
        }
        await sleep(2 ** (attempt + 1) * params.backoffBaseMs);
      }
    }
  }
  throw new Error('Upload finished but the server never confirmed completion.');
}

/**
 * Upload one local file: create the Uploads record (status `queued`), then
 * drive the webapp's chunk protocol against `{appUrl}/api-next/uploads/upload`.
 * The route finalizes the record to `uploaded` on the last chunk, which
 * triggers ingest. On unrecoverable errors the record is marked `failed`
 * (best-effort) so it doesn't sit invisibly stuck, then the error rethrows.
 */
export async function uploadFile(
  pb: TypedPocketBase,
  opts: UploadFileOptions
): Promise<Upload> {
  const {
    filePath,
    workspaceId,
    appUrl,
    directoryId,
    chunkSize = DEFAULT_CHUNK_SIZE,
    maxRetries = 3,
    backoffBaseMs = 1000,
    timeoutMs = 10 * 60 * 1000,
    onCreated,
    onProgress,
  } = opts;

  const { name, size } = await validateUploadFile(filePath);
  const chunks = chunkPlan(size, chunkSize);
  const userId = pb.authStore.record?.id;
  if (!userId) {
    throw new Error('User must be authenticated to upload files');
  }

  const mutator = new UploadMutator(pb);
  const url = `${appUrl}${UPLOAD_ROUTE_PATH}`;
  const fh = await open(filePath, 'r');
  try {
    const created = await mutator.create({
      name,
      size,
      status: UploadStatus.QUEUED,
      bytesUploaded: 0,
      WorkspaceRef: workspaceId,
      UserRef: userId,
      ...(directoryId ? { DirectoryRef: directoryId } : {}),
    });
    onCreated?.(created);

    try {
      const result = await driveChunkProtocol(pb, url, fh, {
        uploadId: created.id,
        workspaceId,
        userId,
        fileName: name,
        fileSize: size,
        chunks,
        directoryId,
        maxRetries,
        backoffBaseMs,
        timeoutMs,
        onProgress,
      });
      return result.upload ?? created;
    } catch (err) {
      try {
        await mutator.updateStatus(
          created.id,
          UploadStatus.FAILED,
          `Upload failed: ${err instanceof Error ? err.message : String(err)}`
        );
      } catch {
        // Best-effort — the original error is what matters.
      }
      throw err;
    }
  } finally {
    await fh.close();
  }
}

/** A media whose stored original is being replaced, with its source upload. */
export interface ReplaceTarget {
  media: Media;
  upload: Upload;
}

/**
 * Resolve the media whose original is being replaced, along with its source
 * upload. Fails when the media doesn't exist or was never ingested into
 * storage — the replace route overwrites the upload's existing
 * `externalPath`, so without one there is nothing to replace.
 */
export async function resolveReplaceTarget(
  pb: TypedPocketBase,
  mediaId: string
): Promise<ReplaceTarget> {
  const media = await new MediaMutator(pb).getById(mediaId, 'UploadRef');
  if (!media) {
    throw new Error(`Media not found: ${mediaId}`);
  }
  const upload =
    media.expand?.UploadRef ??
    (media.UploadRef
      ? await new UploadMutator(pb).getById(media.UploadRef)
      : null);
  if (!upload) {
    throw new Error(`Media ${mediaId} has no source upload record.`);
  }
  if (!upload.externalPath) {
    throw new Error(
      `Media ${mediaId} has no stored original file to replace — ` +
        'upload the file as new media instead.'
    );
  }
  return { media, upload };
}

/**
 * Validate a replacement file: everything `validateUploadFile` checks, plus
 * the rule the webapp replace page enforces — the replacement must be the
 * same kind of media (video for video, etc.), so the media's duration/
 * dimension metadata and derived artifacts stay meaningful.
 */
export async function validateReplacementFile(
  filePath: string,
  media: Media
): Promise<ValidatedUploadFile> {
  const validated = await validateUploadFile(filePath);
  const type = mediaTypeForFile(validated.name);
  if (type !== media.mediaType) {
    throw new Error(
      `Replacement must be a ${media.mediaType} file — ` +
        `"${validated.name}" is ${type ?? 'unknown'}.`
    );
  }
  return validated;
}

export interface ReplaceFileOptions {
  filePath: string;
  /** The upload whose stored original is being overwritten. */
  upload: Upload;
  /** Webapp origin serving `/api-next` (see resolveAppUrl). */
  appUrl: string;
  chunkSize?: number;
  /** Retries per chunk on network errors / 5xx (4xx fails fast). */
  maxRetries?: number;
  /** Base for the 2^attempt exponential backoff; tests pass 0. */
  backoffBaseMs?: number;
  /** Per-chunk request timeout. */
  timeoutMs?: number;
  onProgress?: (progress: UploadProgress) => void;
}

/**
 * Overwrite the stored original of an existing upload with a local file,
 * mirroring the webapp's ChunkedReplaceService: chunks are PUT to
 * `{appUrl}/api-next/uploads/replace`, which stages them at a temporary key
 * and atomically promotes onto the original on the last chunk. The Upload
 * record is never touched — ingest only fires on the transition INTO
 * `uploaded` — so no re-transcode/re-label runs and previews/labels keep
 * reflecting the old file until regenerated. A failure part-way leaves the
 * original blob intact and nothing to clean up record-side.
 */
export async function replaceUploadFile(
  pb: TypedPocketBase,
  opts: ReplaceFileOptions
): Promise<void> {
  const {
    filePath,
    upload,
    appUrl,
    chunkSize = DEFAULT_CHUNK_SIZE,
    maxRetries = 3,
    backoffBaseMs = 1000,
    timeoutMs = 10 * 60 * 1000,
    onProgress,
  } = opts;

  const { name, size } = await validateUploadFile(filePath);
  const chunks = chunkPlan(size, chunkSize);
  const userId = pb.authStore.record?.id;
  if (!userId) {
    throw new Error('User must be authenticated to replace files');
  }

  const url = `${appUrl}${REPLACE_ROUTE_PATH}`;
  const fh = await open(filePath, 'r');
  try {
    await driveChunkProtocol(pb, url, fh, {
      uploadId: upload.id,
      workspaceId: upload.WorkspaceRef,
      userId,
      fileName: name,
      fileSize: size,
      chunks,
      maxRetries,
      backoffBaseMs,
      timeoutMs,
      onProgress,
    });
  } finally {
    await fh.close();
  }
}

/** Default ceiling on how long `pollUploadIngest` waits before giving up. */
export const DEFAULT_INGEST_MAX_WAIT_MS = 10 * 60 * 1000;

/**
 * Poll until the worker finishes ingesting an upload. The Upload record
 * itself never advances past `uploaded` — the worker creates a Media record
 * (initially `isActive: false`) and flips it active when the transcode flow
 * completes — so this polls the Media. Failures surface through the Upload
 * record (`failed`) or a failed ingest Task (`sourceId` = the upload id).
 */
export async function pollUploadIngest(
  pb: TypedPocketBase,
  uploadId: string,
  opts: {
    intervalMs?: number;
    maxWaitMs?: number;
    onUpdate?: (stage: string) => void;
  } = {}
): Promise<Media> {
  const intervalMs = opts.intervalMs ?? 2000;
  const maxWaitMs = opts.maxWaitMs ?? DEFAULT_INGEST_MAX_WAIT_MS;
  const uploadMutator = new UploadMutator(pb);
  const mediaMutator = new MediaMutator(pb);
  const taskMutator = new TaskMutator(pb);
  const deadline = Date.now() + maxWaitMs;
  let lastStage = '';

  while (true) {
    const upload = await uploadMutator.getById(uploadId);
    if (!upload) {
      throw new Error(`Upload ${uploadId} not found.`);
    }
    if (upload.status === UploadStatus.FAILED) {
      throw new Error(upload.errorMessage || 'Upload failed during ingest.');
    }

    const tasks = await taskMutator.getBySourceId(uploadId);
    const failedTask = tasks.items.find(
      (task) => task.status === TaskStatus.FAILED
    );
    if (failedTask) {
      throw new Error(
        `Ingest task ${failedTask.type} failed` +
          (failedTask.errorLog ? `: ${failedTask.errorLog}` : '.')
      );
    }

    const media = await mediaMutator.getByUpload(uploadId);
    if (media?.isActive) {
      return media;
    }

    const stage = media
      ? `processing — media ${media.id}, proxy pending`
      : 'uploaded — waiting for ingest';
    if (stage !== lastStage) {
      opts.onUpdate?.(stage);
      lastStage = stage;
    }

    if (Date.now() + intervalMs > deadline) {
      throw new Error(
        `Timed out after ${Math.round(maxWaitMs / 1000)}s waiting for ingest ` +
          `of upload ${uploadId} (last stage: ${lastStage}). The worker may ` +
          'still be processing — check `vw media list`.'
      );
    }
    await sleep(intervalMs);
  }
}
