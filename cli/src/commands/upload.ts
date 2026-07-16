import type { Command } from 'commander';
import {
  UploadMutator,
  UploadStatus,
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
  replaceUploadFile,
  resolveAppUrl,
  resolveReplaceTarget,
  uploadFile,
  validateReplacementFile,
  validateUploadFile,
  type ValidatedUploadFile,
} from '../lib/upload.js';

interface UploadCommandOptions {
  workspace?: string;
  directory?: string;
  appUrl?: string;
  json?: boolean;
}

interface UploadResult {
  file: string;
  upload?: Upload;
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

  // Ingest (transcode, labels) runs in the worker and can take a long time;
  // the CLI deliberately does not wait for it — check `vw media list`.
  return { file: filePath, upload };
}

export function registerUploadCommands(program: Command): void {
  const upload = program
    .command('upload')
    .description(
      'Upload media files: create new media, or replace the source of an existing one'
    );

  // `create` is the default intent, so the historical `vw upload <files...>`
  // spelling keeps working. `replace` is deliberately a separate, explicit
  // subcommand because it is destructive.
  withJsonOption(
    upload
      .command('create <files...>', { isDefault: true })
      .description(
        'Upload local video/audio/image files into the active workspace as new media (default intent)'
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
            // Keep the token fresh across long multi-file batches —
            // best-effort: a transient network blip here must not abort the
            // whole batch, and a genuinely expired token surfaces as a
            // clear auth failure on the next file's upload anyway.
            await pb
              .collection('Users')
              .authRefresh()
              .catch(() => undefined);
          }
          try {
            results.push(
              await uploadOne(pb, file, validated.get(file)!, {
                workspaceId,
                appUrl,
                directoryId,
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

  withJsonOption(
    upload
      .command('replace <mediaId> <file>')
      .description(
        'Overwrite the stored original of an existing media with an updated source file (destructive — requires --force)'
      )
      .option(
        '--force',
        'actually overwrite; without it the command only reports what would be replaced'
      )
      .option(
        '--app-url <url>',
        'webapp origin serving /api-next (default: derived from the PocketBase URL)'
      )
  ).action(
    async (
      mediaId: string,
      file: string,
      opts: { force?: boolean; appUrl?: string; json?: boolean }
    ) => {
      try {
        const pb = await requireClient();
        const { media: target, upload: targetUpload } =
          await resolveReplaceTarget(pb, mediaId);
        const validated = await validateReplacementFile(file, target);

        if (!opts.force) {
          throw new Error(
            `Replacing the original of media ${target.id} ` +
              `("${targetUpload.name}", ${formatBytes(targetUpload.size)}) with ` +
              `${validated.name} (${formatBytes(validated.size)}) overwrites ` +
              'the stored file and cannot be undone. Previews and labels are ' +
              'not regenerated. Re-run with --force to proceed.'
          );
        }

        const quiet = opts.json === true;
        const totalChunks = chunkPlan(
          validated.size,
          DEFAULT_CHUNK_SIZE
        ).length;
        if (!quiet) {
          info(
            totalChunks > 1
              ? `Uploading replacement ${validated.name} (${formatBytes(validated.size)}, ${totalChunks} chunks of ${formatBytes(DEFAULT_CHUNK_SIZE)})`
              : `Uploading replacement ${validated.name} (${formatBytes(validated.size)})`
          );
        }

        await replaceUploadFile(pb, {
          filePath: file,
          upload: targetUpload,
          appUrl: resolveAppUrl(opts.appUrl),
          onProgress: ({ chunkIndex, bytesUploaded, totalBytes }) => {
            if (quiet || totalChunks === 1) return;
            const percent = Math.round((bytesUploaded / totalBytes) * 100);
            info(`  chunk ${chunkIndex + 1}/${totalChunks} (${percent}%)`);
          },
        });

        if (opts.json) {
          console.log(
            JSON.stringify(
              {
                media: target.id,
                upload: targetUpload.id,
                file: validated.name,
                size: validated.size,
                replaced: true,
              },
              null,
              2
            )
          );
          return;
        }
        success(
          `Replaced original of media ${target.id} with ${validated.name}`
        );
        info(
          '  previews and labels still reflect the previous file — ' +
            'regenerate them from the media details page if needed.'
        );
      } catch (err) {
        handleError(err);
      }
    }
  );
}
