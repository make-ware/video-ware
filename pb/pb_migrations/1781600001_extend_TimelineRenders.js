/// <reference path="../pb_data/types.d.ts" />
// TimelineRenders becomes the source of truth for a render: the client creates
// the record (carrying the render input), a hook spawns the render_timeline
// task, and the worker fills in FileRef/status as it runs. So FileRef is no
// longer required at creation, and the record gains the render input + lifecycle
// fields.
migrate((app) => {
  const collection = app.findCollectionByNameOrId("TimelineRenders");

  // FileRef is set by the worker on completion — not required at creation.
  const fileRef = collection.fields.getByName("FileRef");
  fileRef.required = false;

  collection.fields.add(
    new Field({
      name: "WorkspaceRef",
      id: "rel_render_workspace",
      type: "relation",
      required: false,
      collectionId: "pb_6znl9bq7apv0rcg",
      maxSelect: 1,
      minSelect: 0,
      cascadeDelete: false,
    })
  );

  collection.fields.add(
    new Field({
      name: "UserRef",
      id: "rel_render_user",
      type: "relation",
      required: false,
      collectionId: "_pb_users_auth_",
      maxSelect: 1,
      minSelect: 0,
      cascadeDelete: false,
    })
  );

  collection.fields.add(
    new Field({
      name: "timelineData",
      id: "json_render_timelinedata",
      type: "json",
      required: false,
      maxSize: 5000000,
    })
  );

  collection.fields.add(
    new Field({
      name: "outputSettings",
      id: "json_render_output",
      type: "json",
      required: false,
      maxSize: 200000,
    })
  );

  collection.fields.add(
    new Field({
      name: "status",
      id: "select_render_status",
      type: "select",
      required: false,
      maxSelect: 1,
      values: ["queued", "running", "success", "failed", "canceled"],
    })
  );

  collection.fields.add(
    new Field({
      name: "progress",
      id: "number_render_progress",
      type: "number",
      required: false,
      min: 0,
      max: 100,
    })
  );

  collection.fields.add(
    new Field({
      name: "errorLog",
      id: "text_render_errorlog",
      type: "text",
      required: false,
    })
  );

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("TimelineRenders");

  collection.fields.removeById("rel_render_workspace");
  collection.fields.removeById("rel_render_user");
  collection.fields.removeById("json_render_timelinedata");
  collection.fields.removeById("json_render_output");
  collection.fields.removeById("select_render_status");
  collection.fields.removeById("number_render_progress");
  collection.fields.removeById("text_render_errorlog");

  const fileRef = collection.fields.getByName("FileRef");
  fileRef.required = true;

  return app.save(collection);
});
