/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// Media: add name — a denormalized copy of the source file name
// (UploadRef -> Uploads.name).
//
// Every surface that shows or sorts a media by its file name reaches through
// the relation today (`media.expand.UploadRef.name`, `sort=UploadRef.name`,
// `UploadRef.name ~ {:q}`). That forces an Uploads expand on every list, and
// a client that forgot the expand silently degrades to "Untitled Media".
//
// Safe to denormalize: an Upload's `name` is written once at finalize and the
// replace-in-place path deliberately never touches the Upload record, so the
// file name a Media was ingested from does not change underneath it.
//
// Distinct from `label`: `label` is the editor's own override (usually empty),
// `name` is the file it came from. Display order stays label -> name.
//
// Optional (required: false) because a Media whose Upload was deleted has no
// file name to inherit; the backfill leaves those as "".
// ---------------------------------------------------------------------------

const WORKSPACE_NAME_INDEX =
  "CREATE INDEX idx_media_workspace_name ON Media (WorkspaceRef, name)";

migrate((app) => {
  const collection = app.findCollectionByNameOrId("Media");

  collection.fields.add(new TextField({
    name: "name",
    required: false,
    max: 255,
  }));

  collection.indexes = collection.indexes
    .filter((idx) => idx !== WORKSPACE_NAME_INDEX)
    .concat([WORKSPACE_NAME_INDEX]);

  app.save(collection);

  // Backfill existing rows from their upload. Must run after the save above —
  // the column does not exist until then. One static statement rather than a
  // record loop: this touches every Media in the database.
  //
  // Never throw: a failed boot migration rolls back startup and PocketBase
  // never opens its port. An unbackfilled row degrades to the legacy
  // expand.UploadRef.name lookup, which is survivable; an unbootable server
  // is not.
  try {
    app.db().newQuery(`
      UPDATE Media
         SET name = COALESCE(
               (SELECT u.name FROM Uploads u WHERE u.id = Media.UploadRef),
               ''
             )
       WHERE COALESCE(name, '') = ''
    `).execute();
  } catch (err) {
    console.log("Media.name backfill failed (non-fatal): " + err);
  }

  return null;
}, (app) => {
  const collection = app.findCollectionByNameOrId("Media");

  collection.indexes = collection.indexes.filter(
    (idx) => idx !== WORKSPACE_NAME_INDEX
  );

  collection.fields.removeByName("name");

  return app.save(collection);
});
