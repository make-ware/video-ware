/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    // Directories become flat: no nesting, one name per workspace.

    // 1. Deduplicate names per workspace (case-insensitive) BEFORE the unique
    //    index. Flattening drops the parent that used to distinguish e.g. two
    //    "hawaii" folders. One static statement: per duplicate group the row
    //    with the lowest id keeps the plain name, every other row gets its
    //    record id appended ("hawaii-abc123def456xyz"). Media keep pointing at
    //    the same directory ids either way.
    app
      .db()
      .newQuery(
        "UPDATE Directories SET name = name || '-' || id WHERE id NOT IN (SELECT MIN(id) FROM Directories GROUP BY WorkspaceRef, LOWER(name))"
      )
      .execute();

    const collection = app.findCollectionByNameOrId('Directories');

    // 2. Drop the self-referential parent relation — directories are flat.
    collection.fields.removeById('rel_dir_parent');

    // 3. Path-safe names for new/renamed directories: letters, digits,
    //    dashes, underscores (no spaces or symbols). Existing rows are
    //    untouched until they are edited.
    const nameField = collection.fields.getById('text_dir_name');
    nameField.pattern = '^[A-Za-z0-9][A-Za-z0-9_-]*$';
    nameField.max = 60;

    // 4. One directory name per workspace, case-insensitive.
    collection.indexes = [
      'CREATE UNIQUE INDEX idx_directories_workspace_name ON Directories (WorkspaceRef, name COLLATE NOCASE)',
    ];

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('Directories');

    collection.indexes = [];

    const nameField = collection.fields.getById('text_dir_name');
    nameField.pattern = '';
    nameField.max = 0;

    collection.fields.add(
      new Field({
        name: 'ParentDirectoryRef',
        id: 'rel_dir_parent',
        type: 'relation',
        required: false,
        collectionId: 'pb_directories0001',
        maxSelect: 1,
        minSelect: 0,
        cascadeDelete: false,
        displayFields: null,
      })
    );

    // Dropped parent links and deduplicated names are not restorable.
    return app.save(collection);
  }
);
