import { writeFile } from 'node:fs/promises';
import {
  TimelineRenderMutator,
  TaskStatus,
  type File as PbFile,
  type RenderTimelineConfig,
  type TimelineRender,
  type TypedPocketBase,
} from '@project/shared';
import { apiFetch } from './http.js';

const DEFAULTS = {
  resolution: '1920x1080',
  codec: 'h264',
  format: 'mp4',
} as const;

export interface RenderConfigOptions {
  resolution?: string;
  width?: string;
  height?: string;
  codec?: string;
  format?: string;
  fps?: string;
}

/** Build a RenderTimelineConfig from CLI flags, applying sensible defaults. */
export function buildRenderConfig(
  opts: RenderConfigOptions
): RenderTimelineConfig {
  let resolution = opts.resolution ?? DEFAULTS.resolution;
  if (!opts.resolution && opts.width && opts.height) {
    resolution = `${opts.width}x${opts.height}`;
  }
  const config: RenderTimelineConfig = {
    resolution,
    codec: opts.codec ?? DEFAULTS.codec,
    format: opts.format ?? DEFAULTS.format,
  };
  if (opts.fps !== undefined) {
    // The renderer quantizes every cut to this frame grid, so it only
    // accepts integer rates (and falls back to 30 otherwise) — reject bad
    // values here where the user can still fix the flag.
    const fps = Number(opts.fps);
    if (!Number.isInteger(fps) || fps < 1 || fps > 120) {
      throw new Error('--fps must be an integer frame rate (e.g. 24 or 30).');
    }
    config.fps = fps;
  }
  return config;
}

const TERMINAL = new Set<string>([
  TaskStatus.SUCCESS,
  TaskStatus.FAILED,
  TaskStatus.CANCELED,
]);

type RenderWithFile = TimelineRender & { expand?: { FileRef?: PbFile } };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Default ceiling on how long `pollRender` will wait before giving up. */
export const DEFAULT_RENDER_MAX_WAIT_MS = 10 * 60 * 1000;

/**
 * Poll a TimelineRender until it reaches a terminal status. `onUpdate` is
 * called whenever status or progress changes.
 *
 * Polling is bounded by `maxWaitMs` so a render stuck in a non-terminal state
 * (e.g. `running`) can't hang the caller indefinitely. On timeout this throws
 * with the last observed status/progress.
 */
export async function pollRender(
  pb: TypedPocketBase,
  renderId: string,
  opts: {
    intervalMs?: number;
    maxWaitMs?: number;
    onUpdate?: (status: string, progress: number) => void;
  } = {}
): Promise<RenderWithFile> {
  const intervalMs = opts.intervalMs ?? 2000;
  const maxWaitMs = opts.maxWaitMs ?? DEFAULT_RENDER_MAX_WAIT_MS;
  const mutator = new TimelineRenderMutator(pb);
  const deadline = Date.now() + maxWaitMs;
  let lastKey = '';
  let lastStatus: string = TaskStatus.QUEUED;
  let lastProgress = 0;

  while (true) {
    const render = (await mutator.getById(
      renderId,
      'FileRef'
    )) as RenderWithFile | null;
    if (!render) {
      throw new Error(`Render ${renderId} not found.`);
    }

    const status: string =
      (Array.isArray(render.status) ? render.status[0] : render.status) ??
      TaskStatus.QUEUED;
    const progress = render.progress ?? 0;
    lastStatus = status;
    lastProgress = progress;
    const key = `${status}:${progress}`;
    if (key !== lastKey) {
      opts.onUpdate?.(status, progress);
      lastKey = key;
    }

    if (TERMINAL.has(status)) {
      return render;
    }

    if (Date.now() + intervalMs > deadline) {
      throw new Error(
        `Timed out after ${Math.round(maxWaitMs / 1000)}s waiting for render ${renderId} ` +
          `(last status: ${lastStatus} at ${lastProgress}%). ` +
          `The render may still be processing — re-run to resume polling.`
      );
    }

    await sleep(intervalMs);
  }
}

/** Build a download URL for a render's output file (PocketBase-hosted files). */
export function renderFileUrl(
  pb: TypedPocketBase,
  render: RenderWithFile
): string | null {
  const file = render.expand?.FileRef;
  if (!file?.file) return null;
  return pb.files.getURL(file, file.file);
}

/** Download a render's output file to `destPath`. */
export async function downloadRender(
  pb: TypedPocketBase,
  render: RenderWithFile,
  destPath: string
): Promise<void> {
  const url = renderFileUrl(pb, render);
  if (!url) {
    throw new Error(
      'Output file is not hosted in PocketBase (likely S3/GCS) — cannot download directly.'
    );
  }
  const res = await apiFetch(url);
  if (!res.ok) {
    throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  await writeFile(destPath, buffer);
}
