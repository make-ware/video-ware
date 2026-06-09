/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    // The recommendation feature has been removed. Delete any MediaClips that
    // were created from recommendations (the removed ClipType.RECOMMENDATION
    // value). Label-derived clips (clipData.sourceType === "label") are kept.
    // Fetch-and-delete in batches; always read offset 0 since deletes shift the set.
    while (true) {
      const records = app.findRecordsByFilter(
        "MediaClips",
        "type = 'recommendation'",
        "",
        500,
        0
      );
      if (!records || records.length === 0) {
        break;
      }
      for (const record of records) {
        if (record) {
          app.delete(record);
        }
      }
      if (records.length < 500) {
        break;
      }
    }
  },
  (_app) => {
    // No-op: deleted recommendation clips cannot be restored.
  }
);
