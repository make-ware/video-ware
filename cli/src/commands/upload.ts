import type { Command } from 'commander';
import {
  UploadMutator,
  UploadStatus,
  type Media,
  type TypedPocketBase,
  type Upload,
} from '@project/shared';
import { isRootDirRef, resolveDirectory } from '../lib/directory.js';
import { withJsonOption } from '../lib/options.js';
import { error, info, success } from '../lib/output.js';
import { handleError, requireClient } from '../lib/run.js';
import { resolveWorkspaceId } from '../lib/select.js';
import {
  DEFAULT_CHUNK_SIZE,
  chunkPlan,
  formatBytes,
  pollUploadIngest,
  resolveAppUrl,
  uploadFile,
  validateUploadFile,
  type ValidatedUploadFile,
} from '../lib/upload.js';

interface UploadCommandOptions {
  workspace?: string;
  directory?: string;
  appUrl?: string;
  wait?: boolean;
  json?: boolean;
}

interface UploadResult {
  file: string;
  upload?: Upload;
  media?: Media;
  error?: string;
}

async function uploadOne(
  pb: TypedPocketBase,
  filePath: string,
  validated: ValidatedUploadFile,
  ctx: {
    workspaceId: string;
    appUrl: string;
    directoryId?: string;
    wait?: boolean;
    json?: boolean;
    setCurrentUploadId: (id: string | null) => void;
  }
): Promise<UploadResult> {
  const { name, size } = validated;
  const totalChunks = chunkPlan(size, DEFAULT_CHUNK_SIZE).length;
  const quiet = ctx.json === true;

  if (!quiet) {
    info(
      totalChunks > 1
        ? `Uploading ${name} (${formatBytes(size)}, ${totalChunks} chunks of ${formatBytes(DEFAULT_CHUNK_SIZE)})`
        : `Uploading ${name} (${formatBytes(size)})`
    );
  }

  let upload: Upload;
  try {
    upload = await uploadFile(pb, {
      filePath,
      workspaceId: ctx.workspaceId,
      appUrl: ctx.appUrl,
      directoryId: ctx.directoryId,
      onCreated: (created) => ctx.setCurrentUploadId(created.id),
      onProgress: ({ chunkIndex, bytesUploaded, totalBytes }) => {
        if (quiet || totalChunks === 1) return;
        const percent = Math.round((bytesUploaded / totalBytes) * 100);
        info(`  chunk ${chunkIndex + 1}/${totalChunks} (${percent}%)`);
      },
    });
  } finally {
    // Uploaded (or already marked failed) — a late Ctrl+C must not touch it.
    ctx.setCurrentUploadId(null);
  }
  if (!quiet) success(`Uploaded ${name} → upload ${upload.id}`);

  if (!ctx.wait) {
    return { file: filePath, upload };
  }

  const media = await pollUploadIngest(pb, upload.id, {
    onUpdate: (stage) => {
      if (!quiet) info(`  ${stage}`);
    },
  });
  if (!quiet) success(`Media ${media.id} ready`);
  return { file: filePath, upload, media };
}

export function registerUploadCommands(program: Command): void {
  withJsonOption(
    program
      .command('upload <files...>')
      .description(
        'Upload local video/audio/image files into the active workspace'
      )
      .option('-w, --workspace <id>', 'workspace id override')
      .option(
        '--directory <dir>',
        'file the new media into a directory (name or id; omit or "/" = workspace root)'
      )
      .option(
        '--app-url <url>',
        'webapp origin serving /api-next (default: derived from the PocketBase URL)'
      )
      .option(
        '--wait',
        'poll until the media is ingested and its proxy is ready'
      )
  ).action(async (files: string[], opts: UploadCommandOptions) => {
    try {
      const pb = await requireClient();
      const workspaceId = await resolveWorkspaceId(pb, opts.workspace);
      // Root refs ("/", "root", "none") mean the workspace root, same as
      // every other directory-taking flag — an upload without a directory.
      const directoryId =
        opts.directory && !isRootDirRef(opts.directory)
          ? (await resolveDirectory(pb, workspaceId, opts.directory)).id
          : undefined;
      const appUrl = resolveAppUrl(opts.appUrl);

      // Validate every file up front so a bad one fails before any upload.
      const validated = new Map<string, ValidatedUploadFile>();
      for (const file of files) {
        validated.set(file, await validateUploadFile(file));
      }

      // A Ctrl+C mid-transfer would strand the record `uploading` forever
      // (there is no server-side reaper) — mark it failed like the webapp's
      // cancel path does, then exit with the conventional SIGINT code.
      let currentUploadId: string | null = null;
      const onSigint = (): void => {
        const id = currentUploadId;
        if (!id) process.exit(130);
        void new UploadMutator(pb)
          .updateStatus(id, UploadStatus.FAILED, 'Upload cancelled by user')
          .catch(() => undefined)
          .finally(() => process.exit(130));
      };
      process.once('SIGINT', onSigint);

      const results: UploadResult[] = [];
      let failures = 0;
      try {
        for (const [i, file] of files.entries()) {
          if (i > 0) {
            // Keep the token fresh across long multi-file batches.
            await pb.collection('Users').authRefresh();
          }
          try {
            results.push(
              await uploadOne(pb, file, validated.get(file)!, {
                workspaceId,
                appUrl,
                directoryId,
                wait: opts.wait,
                json: opts.json,
                setCurrentUploadId: (id) => {
                  currentUploadId = id;
                },
              })
            );
          } catch (err) {
            failures++;
            const message = err instanceof Error ? err.message : String(err);
            if (!opts.json) error(`${file}: ${message}`);
            results.push({ file, error: message });
          }
        }
      } finally {
        process.removeListener('SIGINT', onSigint);
      }

      if (opts.json) {
        console.log(JSON.stringify(results, null, 2));
      }
      if (failures > 0) {
        process.exit(1);
      }
    } catch (err) {
      handleError(err);
    }
  });
}
