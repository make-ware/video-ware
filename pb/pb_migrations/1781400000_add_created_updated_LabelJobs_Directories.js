/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  // LabelJobs and Directories were created without the standard
  // created/updated autodate fields, which breaks `sort=-created` queries.
  const collections = [
    "pb_64xagwh9qro4ta9", // LabelJobs
    "pb_directories0001", // Directories
  ];

  for (const id of collections) {
    const collection = app.findCollectionByNameOrId(id);

    if (!collection.fields.getByName("created")) {
      collection.fields.add(new AutodateField({
        name: "created",
        onCreate: true,
        onUpdate: false,
      }));
    }

    if (!collection.fields.getByName("updated")) {
      collection.fields.add(new AutodateField({
        name: "updated",
        onCreate: true,
        onUpdate: true,
      }));
    }

    app.save(collection);
  }
}, (app) => {
  const collections = [
    "pb_64xagwh9qro4ta9", // LabelJobs
    "pb_directories0001", // Directories
  ];

  for (const id of collections) {
    const collection = app.findCollectionByNameOrId(id);
    collection.fields.removeByName("created");
    collection.fields.removeByName("updated");
    app.save(collection);
  }
});
