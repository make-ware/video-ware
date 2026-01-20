/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection_Media_add_thumbnailFileRef = app.findCollectionByNameOrId("Media");

  collection_Media_add_thumbnailFileRef.fields.add(new RelationField({
    name: "thumbnailFileRef",
    required: false,
    collectionId: "pb_48ql3az7t9ok2mu",
    maxSelect: 1,
    minSelect: 0,
    cascadeDelete: false
  }));

  app.save(collection_Media_add_thumbnailFileRef);

  const collection_Media_add_spriteFileRef = app.findCollectionByNameOrId("Media");

  collection_Media_add_spriteFileRef.fields.add(new RelationField({
    name: "spriteFileRef",
    required: false,
    collectionId: "pb_48ql3az7t9ok2mu",
    maxSelect: 1,
    minSelect: 0,
    cascadeDelete: false
  }));

  app.save(collection_Media_add_spriteFileRef);

  const collection_Media_add_proxyFileRef = app.findCollectionByNameOrId("Media");

  collection_Media_add_proxyFileRef.fields.add(new RelationField({
    name: "proxyFileRef",
    required: false,
    collectionId: "pb_48ql3az7t9ok2mu",
    maxSelect: 1,
    minSelect: 0,
    cascadeDelete: false
  }));

  return app.save(collection_Media_add_proxyFileRef);
}, (app) => {
  const collection_Media_revert_add_thumbnailFileRef = app.findCollectionByNameOrId("Media");

  collection_Media_revert_add_thumbnailFileRef.fields.removeByName("thumbnailFileRef");

  app.save(collection_Media_revert_add_thumbnailFileRef);

  const collection_Media_revert_add_spriteFileRef = app.findCollectionByNameOrId("Media");

  collection_Media_revert_add_spriteFileRef.fields.removeByName("spriteFileRef");

  app.save(collection_Media_revert_add_spriteFileRef);

  const collection_Media_revert_add_proxyFileRef = app.findCollectionByNameOrId("Media");

  collection_Media_revert_add_proxyFileRef.fields.removeByName("proxyFileRef");

  return app.save(collection_Media_revert_add_proxyFileRef);
});
