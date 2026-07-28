/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// Media: add rotation — display rotation in degrees (0, 90, 180, 270).
//
// MediaSchema already declares `rotation: NumberField().optional().default(0)`
// but the column never existed, so every read fell back to the Zod default and
// nothing could persist a rotation.
//
// Left bare (no min/max/onlyInt) on purpose: the schema declares a plain
// NumberField, and adding DB-side bounds here would re-open the same drift this
// migration closes. The 0/90/180/270 domain is enforced where rotation is set.
//
// No backfill. PocketBase serializes a missing number as 0, which is exactly
// the "no rotation" default — so existing rows already read as 0 and a
// full-table UPDATE would buy nothing.
// ---------------------------------------------------------------------------
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId("Media");

    collection.fields.add(
      new NumberField({
        name: "rotation",
        required: false,
      })
    );

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId("Media");

    collection.fields.removeByName("rotation");

    return app.save(collection);
  }
);
