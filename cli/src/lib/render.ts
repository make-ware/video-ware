import { writeFile } from 'node:fs/promises';
import {
  TimelineRenderMutator,
  TaskStatus,
  type File as PbFile,
  type RenderTimelineConfig,
  type TimelineRender,
  type TypedPocketBase,
} from '@project/shared';

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
}

/** Build a RenderTimelineConfig from CLI flags, applying sensible defaults. */
export function buildRenderConfig(
  opts: RenderConfigOptions
): RenderTimelineConfig {
  let resolution = opts.resolution ?? DEFAULTS.resolution;
  if (!opts.resolution && opts.width && opts.height) {
    resolution = `${opts.width}x${opts.height}`;
  }
  return {
    resolution,
    codec: opts.codec ?? DEFAULTS.codec,
    format: opts.format ?? DEFAULTS.format,
  };
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

/**
 * Poll a TimelineRender until it reaches a terminal status. `onUpdate` is
 * called whenever status or progress changes.
 */
export async function pollRender(
  pb: TypedPocketBase,
  renderId: string,
  opts: {
    intervalMs?: number;
    onUpdate?: (status: string, progress: number) => void;
  } = {}
): Promise<RenderWithFile> {
  const intervalMs = opts.intervalMs ?? 2000;
  const mutator = new TimelineRenderMutator(pb);
  let lastKey = '';

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
    const key = `${status}:${progress}`;
    if (key !== lastKey) {
      opts.onUpdate?.(status, progress);
      lastKey = key;
    }

    if (TERMINAL.has(status)) {
      return render;
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
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  await writeFile(destPath, buffer);
}
