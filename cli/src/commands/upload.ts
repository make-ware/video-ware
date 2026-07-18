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
import { error, info, printList, success } from '../lib/output.js';
import { handleError, requireClient } from '../lib/run.js';
import { resolveWorkspaceId } from '../lib/select.js';
import {
  DEFAULT_CHUNK_SIZE,
  chunkPlan,
  formatBytes,
  listUploads,
  mediaByUpload,
  mediaTypeForFile,
  parseUploadStatus,
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

interface UploadListOptions {
  workspace?: string;
  status?: string;
  limit?: number;
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
      .command('list')
      .alias('ls')
      .description(
        'List uploads in the active workspace by original file name, with the media ingested from each'
      )
      .option('-w, --workspace <id>', 'workspace id override')
      .option(
        '--status <status>',
        'filter by upload status (queued, uploading, uploaded, processing, ready, failed)'
      )
      .option('-n, --limit <count>', 'max results (default: 200)', (v) =>
        parseInt(v, 10)
      )
  ).action(async (opts: UploadListOptions) => {
    try {
      const pb = await requireClient();
      const workspaceId = await resolveWorkspaceId(pb, opts.workspace);
      const status = opts.status ? parseUploadStatus(opts.status) : undefined;
      const result = await listUploads(pb, workspaceId, {
        status,
        limit: opts.limit,
      });
      // The MEDIA column is a display-only convenience; skip the extra query
      // in --json mode, where scripts key off the upload id directly (which
      // `vw upload replace` now accepts).
      const media = opts.json
        ? new Map<string, Media>()
        : await mediaByUpload(pb, workspaceId);
      printList(
        result.items,
        [
          { header: 'ID', value: (u) => u.id },
          { header: 'NAME', value: (u) => u.name },
          { header: 'STATUS', value: (u) => String(u.status) },
          { header: 'SIZE', value: (u) => formatBytes(u.size) },
          { header: 'MEDIA', value: (u) => media.get(u.id)?.id ?? '—' },
        ],
        {
          json: opts.json,
          totalItems: result.totalItems,
          hint: 'pass an id to `vw upload replace`',
        }
      );
    } catch (err) {
      handleError(err);
    }
  });

  withJsonOption(
    upload
      .command('replace <mediaOrUploadId> <file>')
      .description(
        'Overwrite the stored original of an existing media/upload with an updated source file (destructive — requires --force). The id may be a media id or an upload id.'
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
      ref: string,
      file: string,
      opts: { force?: boolean; appUrl?: string; json?: boolean }
    ) => {
      try {
        const pb = await requireClient();
        const { media, upload, resolvedBy } = await resolveReplaceTarget(
          pb,
          ref
        );
        // Enforce the same media type as the target: its media's type, or —
        // when replacing an upload that never produced media — the type its own
        // filename implies. mediaType is a SelectField (MediaType | MediaType[]),
        // so narrow it to a single value first.
        const mediaType = media
          ? Array.isArray(media.mediaType)
            ? media.mediaType[0]
            : media.mediaType
          : undefined;
        const expectedType = mediaType ?? mediaTypeForFile(upload.name);
        const validated = await validateReplacementFile(file, expectedType);

        const targetDesc = media
          ? `media ${media.id} (upload ${upload.id}, "${upload.name}")`
          : `upload ${upload.id} ("${upload.name}")`;

        if (!opts.force) {
          throw new Error(
            `Replacing the original of ${targetDesc}, ${formatBytes(upload.size)}, ` +
              `with ${validated.name} (${formatBytes(validated.size)}) overwrites ` +
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
          upload,
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
                media: media?.id ?? null,
                upload: upload.id,
                resolvedBy,
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
        success(`Replaced original of ${targetDesc} with ${validated.name}`);
        info(
          media
            ? '  previews and labels still reflect the previous file — ' +
                'regenerate them from the media details page if needed.'
            : '  no ingested media is linked to this upload — ' +
                'only the stored original file was replaced.'
        );
      } catch (err) {
        handleError(err);
      }
    }
  );
}
