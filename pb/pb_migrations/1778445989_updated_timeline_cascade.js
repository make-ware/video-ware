/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  for (const name of ['TimelineClips', 'TimelineRenders', 'TimelineRecommendations', 'TimelineTracks']) {
    const collection = app.findCollectionByNameOrId(name);
    const field = collection.fields.getByName('TimelineRef');
    field.cascadeDelete = true;
    app.save(collection);
  }
}, (app) => {
  for (const name of ['TimelineClips', 'TimelineRenders', 'TimelineRecommendations', 'TimelineTracks']) {
    const collection = app.findCollectionByNameOrId(name);
    const field = collection.fields.getByName('TimelineRef');
    field.cascadeDelete = false;
    app.save(collection);
  }
});
