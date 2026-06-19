import type { Command } from 'commander';
import { TaskStatus, TimelineMutator } from '@project/shared';
import { handleError, requireClient } from '../lib/run.js';
import { pickMedia, pickTimeline, resolveWorkspaceId } from '../lib/select.js';
import { createRender, insertClip } from '../lib/timeline.js';
import {
  buildRenderConfig,
  downloadRender,
  pollRender,
  renderFileUrl,
} from '../lib/render.js';
import { formatDuration, info, success, table } from '../lib/output.js';

export function registerTimelineCommands(program: Command): void {
  const timeline = program
    .command('timeline')
    .alias('tl')
    .description('Work with timelines');

  timeline
    .command('list')
    .alias('ls')
    .description('List timelines in the active workspace')
    .option('-w, --workspace <id>', 'workspace id override')
    .action(async (opts) => {
      try {
        const pb = await requireClient();
        const workspaceId = await resolveWorkspaceId(pb, opts.workspace);
        const result = await new TimelineMutator(pb).getByWorkspace(
          workspaceId,
          1,
          200
        );
        table(result.items, [
          { header: 'ID', value: (t) => t.id },
          { header: 'NAME', value: (t) => t.name },
          { header: 'DURATION', value: (t) => formatDuration(t.duration) },
          { header: 'VERSION', value: (t) => String(t.version ?? 1) },
        ]);
      } catch (err) {
        handleError(err);
      }
    });

  timeline
    .command('insert')
    .description('Insert media into a timeline')
    .option('-w, --workspace <id>', 'workspace id override')
    .option('-t, --timeline <id>', 'timeline id')
    .option('-m, --media <id>', 'media id')
    .option('-s, --start <seconds>', 'trim start in source media', parseFloat)
    .option('-e, --end <seconds>', 'trim end in source media', parseFloat)
    .option('--track <id>', 'target track id')
    .action(async (opts) => {
      try {
        const pb = await requireClient();
        const workspaceId = await resolveWorkspaceId(pb, opts.workspace);

        let timelineId = opts.timeline as string | undefined;
        if (!timelineId) {
          timelineId = (await pickTimeline(pb, workspaceId)).id;
        }

        let mediaId = opts.media as string | undefined;
        if (!mediaId) {
          mediaId = (await pickMedia(pb, workspaceId)).id;
        }

        const clip = await insertClip(pb, {
          timelineId,
          mediaId,
          start: opts.start,
          end: opts.end,
          trackId: opts.track,
        });
        success(
          `Inserted clip ${clip.id} (order ${clip.order}, ${formatDuration(clip.duration)}) into timeline ${timelineId}`
        );
      } catch (err) {
        handleError(err);
      }
    });

  timeline
    .command('render')
    .description('Render a timeline')
    .option('-w, --workspace <id>', 'workspace id override')
    .option('-t, --timeline <id>', 'timeline id')
    .option('--format <fmt>', 'output container format (default: mp4)')
    .option('--codec <codec>', 'video codec (default: h264)')
    .option('--resolution <WxH>', 'output resolution, e.g. 1920x1080')
    .option('--width <px>', 'output width (use with --height)')
    .option('--height <px>', 'output height (use with --width)')
    .option('--no-wait', 'enqueue and exit without polling for completion')
    .option('--download <path>', 'download the output file on success')
    .action(async (opts) => {
      try {
        const pb = await requireClient();
        const workspaceId = await resolveWorkspaceId(pb, opts.workspace);

        let timelineId = opts.timeline as string | undefined;
        if (!timelineId) {
          timelineId = (await pickTimeline(pb, workspaceId)).id;
        }

        const outputSettings = buildRenderConfig({
          resolution: opts.resolution,
          width: opts.width,
          height: opts.height,
          codec: opts.codec,
          format: opts.format,
        });

        const render = await createRender(pb, { timelineId, outputSettings });
        success(`Render queued: ${render.id}`);

        if (opts.wait === false) {
          info('Skipping wait — poll status with the webapp or re-run later.');
          return;
        }

        const final = await pollRender(pb, render.id, {
          onUpdate: (status, progress) => info(`  ${status} (${progress}%)`),
        });

        if (final.status === TaskStatus.SUCCESS) {
          const url = renderFileUrl(pb, final);
          success(
            `Render complete. ${url ? `Output: ${url}` : 'Output stored externally (S3/GCS).'}`
          );
          if (opts.download) {
            await downloadRender(pb, final, opts.download);
            success(`Saved to ${opts.download}`);
          }
        } else {
          handleError(
            new Error(
              `Render ${final.status}: ${final.errorLog ?? 'no details'}`
            )
          );
        }
      } catch (err) {
        handleError(err);
      }
    });
}
