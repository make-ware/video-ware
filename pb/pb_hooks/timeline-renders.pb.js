/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// TimelineRender -> render trigger
//
// Creating a TimelineRender record (which carries the render input as
// `timelineData` + `outputSettings`) creates ONE `render_timeline` Task. The
// worker reads the TimelineRender, renders in the background, and writes the
// output file + status back onto the same record. Create-only: a new render
// attempt is a new TimelineRender record.
// ---------------------------------------------------------------------------
onRecordAfterCreateSuccess((e) => {
  try {
    const render = e.record;
    const renderId = render.id;

    // Idempotency: skip if a render task for this render is already active.
    try {
      $app.findFirstRecordByFilter(
        'Tasks',
        "sourceId = {:id} && type = 'render_timeline' && (status = 'queued' || status = 'running')",
        { id: renderId }
      );
      return;
    } catch (notFound) {
      // No active task -> create one.
    }

    const tasks = $app.findCollectionByNameOrId('Tasks');
    const task = new Record(tasks);
    task.set('sourceType', 'TimelineRender');
    task.set('sourceId', renderId);
    task.set('type', 'render_timeline');
    task.set('status', 'queued');
    task.set('progress', 1);
    task.set('attempts', 1);
    task.set('priority', 0);
    task.set('payload', { timelineRenderId: renderId });
    task.set('WorkspaceRef', render.get('WorkspaceRef'));
    task.set('UserRef', render.get('UserRef'));
    $app.save(task);
  } catch (error) {
    console.error('Failed to create render_timeline task for render:', error);
  } finally {
    e.next();
  }
}, 'TimelineRenders');
