/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// Hung-task watchdog
//
// Task status transitions are driven by BullMQ's local, in-process
// `@OnWorkerEvent` handlers in the worker (see worker/src/queue/processors).
// If the worker process crashes or is force-restarted mid-job, no
// completed/failed event ever fires, so the Task is left at `running` (or
// `queued`, if it dies before even picking the job up) forever. BullMQ stays
// the source of truth for the job itself, but nothing re-derives the Task's
// status from that once the local event stream is gone — this cron is the
// safety net that unwedges those tasks so they stop needing manual cleanup.
//
// This can NOT simply be "no update in N minutes -> fail": `Task.updated`
// only moves at step/task boundaries, not continuously during a step's body.
// Some steps are legitimately silent for hours:
//   - Google Video Intelligence label detection polls a long-running
//     operation for up to 2h (VIDEO_INTELLIGENCE_POLLING.pollTotalTimeoutMs
//     in worker/src/shared/services/google-cloud.service.ts) with zero
//     PocketBase writes in between.
//   - ffmpeg-backed render/transcode steps have their own internal watchdog
//     (worker/src/shared/services/ffmpeg.service.ts) allowing up to 8h per
//     invocation before it self-kills the process.
// So thresholds below are deliberately generous — sized well above those
// known ceilings — to keep false positives on genuinely long jobs rare. If
// you see real hangs taking longer than these to get reaped, or false
// positives on legitimate long-running work, adjust the constants below
// rather than the cron logic.
//
// PocketBase note: this cron handler is serialized and executed in an isolated
// goja runtime from the pool, so it CANNOT reference functions or constants
// from the file's top-level scope (that scope only exists during startup
// registration — see the earlier duplicate-const collision that shared scope
// caused). Everything the handler uses must be defined INSIDE it, which is why
// the constants and reapHungTasks live in the callback body. All the other
// pb_hooks/*.pb.js follow the same self-contained-handler discipline.
// ---------------------------------------------------------------------------

// Runs at the top of every hour. The staleness thresholds below are measured in
// hours, so hourly granularity is plenty to reap hung tasks promptly.
cronAdd('tasksWatchdog', '0 * * * *', () => {
  const HOUR = 60 * 60;

  // Tasks stuck in `running`, keyed by provider. `default` covers tasks with no
  // provider set (lightweight orchestration-only steps) and any provider not
  // listed explicitly.
  const RUNNING_STALE_SECONDS_BY_PROVIDER = {
    // ffmpeg's own stall/hard-timeout watchdog caps a single invocation at 8h.
    ffmpeg: 2 * 10 * HOUR,
    // No per-step ceiling found for these; treated as conservatively as GCVI.
    google_transcoder: 2 * 4 * HOUR,
    google_speech: 2 * 4 * HOUR,
    // GCVI's operation-polling timeout caps a single step at 2h.
    google_video_intelligence: 2 * 4 * HOUR,
    default: 2 * 1 * HOUR,
  };

  // Tasks stuck in `queued` — the worker never picked them up at all (down,
  // crashed before dequeuing, etc). Not provider-specific since nothing has
  // started running yet.
  const QUEUED_STALE_SECONDS = 2 * 1 * HOUR;

  const PAGE = 200;

  function reapHungTasks(app) {
    const nowSec = Math.floor(Date.now() / 1000);
    let offset = 0;
    let reaped = 0;
    let scanned = 0;

    while (true) {
      const tasks = app.findRecordsByFilter(
        'Tasks',
        "status = 'running' || status = 'queued'",
        'id',
        PAGE,
        offset
      );
      if (!tasks || tasks.length === 0) break;

      for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];
        if (!task) continue;
        scanned++;

        const status = task.get('status');
        const provider = task.get('provider') || '';
        const updatedUnix = task.getDateTime('updated').unix();
        const ageSec = nowSec - updatedUnix;

        const thresholdSec =
          status === 'queued'
            ? QUEUED_STALE_SECONDS
            : RUNNING_STALE_SECONDS_BY_PROVIDER[provider] ||
              RUNNING_STALE_SECONDS_BY_PROVIDER.default;

        if (ageSec <= thresholdSec) continue;

        try {
          const bullJobId = task.get('bullJobId') || 'unknown';
          const queueName = task.get('queueName') || 'unknown';
          task.set('status', 'failed');
          task.set(
            'errorLog',
            `watchdog: task stuck in "${status}" for ${Math.round(ageSec / 60)}m ` +
              `(threshold ${Math.round(thresholdSec / 60)}m, provider=${provider || 'none'}, ` +
              `bullJobId=${bullJobId}, queue=${queueName}) — marked failed by cron-tasks-watchdog`
          );
          app.save(task);
          reaped++;
          console.log(
            `tasksWatchdog: failed hung task ${task.id} (type=${task.get('type')}, status=${status}, ageMin=${Math.round(ageSec / 60)}, bullJobId=${bullJobId}, queue=${queueName})`
          );
        } catch (error) {
          console.error(`tasksWatchdog: failed to reap task ${task.id}:`, error);
        }
      }

      if (tasks.length < PAGE) break;
      offset += tasks.length;
    }

    console.log(`tasksWatchdog: scanned ${scanned} task(s), reaped ${reaped}`);
  }

  try {
    reapHungTasks($app);
  } catch (error) {
    console.error('tasksWatchdog: run failed:', error);
  }
});
