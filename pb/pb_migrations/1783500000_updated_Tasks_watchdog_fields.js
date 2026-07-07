/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// Tasks: add bullJobId/queueName so a Task can be traced back to the BullMQ
// job that's actually running it.
//
// Today nothing on a Task links it to a specific BullMQ job/queue, so once a
// Task looks stuck there's no way to check BullMQ's own state for it short of
// grepping job data by taskId. These fields are set by the worker the moment
// a job claims a task (the `active` event) and are read by the
// cron-tasks-watchdog cron for logging/debugging context when it fails a
// hung task.
// ---------------------------------------------------------------------------

migrate((app) => {
  const collection = app.findCollectionByNameOrId('Tasks');

  collection.fields.add(
    new TextField({
      name: 'bullJobId',
      required: false,
    })
  );

  collection.fields.add(
    new TextField({
      name: 'queueName',
      required: false,
    })
  );

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId('Tasks');

  collection.fields.removeByName('bullJobId');
  collection.fields.removeByName('queueName');

  return app.save(collection);
});
