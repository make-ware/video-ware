/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// Attribution indexes for entity-tag queries.
//
// Entity attribution resolves through two link points — a label row's
// LabelTrackRef (per-media instance link, wins) or its LabelEntityRef
// provider cluster (workspace-wide fallback; see 1783296001/1783296002).
// The attribution filters (`vw label search --entity`, `vw entity
// labels/words`, webapp entity pages) JOIN through those relation columns
// workspace-wide, so every leaf label collection needs both columns indexed.
//
// This fills the gaps: LabelSpeaker (the primary surface — "everything Erik
// said" — had neither), LabelSpeech (neither), LabelText (track missing),
// LabelObjects/LabelPerson/LabelFaces (cluster missing), plus
// LabelTrack.LabelEntityRef for the track-level fallback — only the
// (MediaRef, LabelEntityRef) composite existed, which can't serve a
// workspace-wide cluster lookup. LabelShots/LabelSegments have no
// LabelTrackRef field and their LabelEntityRef is already indexed.
// ---------------------------------------------------------------------------

migrate(
  (app) => {
    let collection;

    collection = app.findCollectionByNameOrId('LabelSpeaker');
    collection.indexes = collection.indexes
      .filter(
        (idx) =>
          idx !==
            'CREATE INDEX idx_label_speaker_track ON LabelSpeaker (LabelTrackRef)' &&
          idx !==
            'CREATE INDEX idx_label_speaker_entity ON LabelSpeaker (LabelEntityRef)'
      )
      .concat([
        'CREATE INDEX idx_label_speaker_track ON LabelSpeaker (LabelTrackRef)',
        'CREATE INDEX idx_label_speaker_entity ON LabelSpeaker (LabelEntityRef)',
      ]);
    app.save(collection);

    collection = app.findCollectionByNameOrId('LabelSpeech');
    collection.indexes = collection.indexes
      .filter(
        (idx) =>
          idx !==
            'CREATE INDEX idx_label_speech_track ON LabelSpeech (LabelTrackRef)' &&
          idx !==
            'CREATE INDEX idx_label_speech_entity ON LabelSpeech (LabelEntityRef)'
      )
      .concat([
        'CREATE INDEX idx_label_speech_track ON LabelSpeech (LabelTrackRef)',
        'CREATE INDEX idx_label_speech_entity ON LabelSpeech (LabelEntityRef)',
      ]);
    app.save(collection);

    collection = app.findCollectionByNameOrId('LabelText');
    collection.indexes = collection.indexes
      .filter(
        (idx) =>
          idx !==
          'CREATE INDEX idx_label_text_track ON LabelText (LabelTrackRef)'
      )
      .concat([
        'CREATE INDEX idx_label_text_track ON LabelText (LabelTrackRef)',
      ]);
    app.save(collection);

    collection = app.findCollectionByNameOrId('LabelObjects');
    collection.indexes = collection.indexes
      .filter(
        (idx) =>
          idx !==
          'CREATE INDEX idx_label_object_entity ON LabelObjects (LabelEntityRef)'
      )
      .concat([
        'CREATE INDEX idx_label_object_entity ON LabelObjects (LabelEntityRef)',
      ]);
    app.save(collection);

    collection = app.findCollectionByNameOrId('LabelPerson');
    collection.indexes = collection.indexes
      .filter(
        (idx) =>
          idx !==
          'CREATE INDEX idx_label_person_entity ON LabelPerson (LabelEntityRef)'
      )
      .concat([
        'CREATE INDEX idx_label_person_entity ON LabelPerson (LabelEntityRef)',
      ]);
    app.save(collection);

    collection = app.findCollectionByNameOrId('LabelFaces');
    collection.indexes = collection.indexes
      .filter(
        (idx) =>
          idx !==
          'CREATE INDEX idx_label_face_entity ON LabelFaces (LabelEntityRef)'
      )
      .concat([
        'CREATE INDEX idx_label_face_entity ON LabelFaces (LabelEntityRef)',
      ]);
    app.save(collection);

    collection = app.findCollectionByNameOrId('LabelTrack');
    collection.indexes = collection.indexes
      .filter(
        (idx) =>
          idx !==
          'CREATE INDEX idx_label_track_cluster ON LabelTrack (LabelEntityRef)'
      )
      .concat([
        'CREATE INDEX idx_label_track_cluster ON LabelTrack (LabelEntityRef)',
      ]);
    app.save(collection);
  },
  (app) => {
    let collection;

    collection = app.findCollectionByNameOrId('LabelSpeaker');
    collection.indexes = collection.indexes.filter(
      (idx) =>
        idx !==
          'CREATE INDEX idx_label_speaker_track ON LabelSpeaker (LabelTrackRef)' &&
        idx !==
          'CREATE INDEX idx_label_speaker_entity ON LabelSpeaker (LabelEntityRef)'
    );
    app.save(collection);

    collection = app.findCollectionByNameOrId('LabelSpeech');
    collection.indexes = collection.indexes.filter(
      (idx) =>
        idx !==
          'CREATE INDEX idx_label_speech_track ON LabelSpeech (LabelTrackRef)' &&
        idx !==
          'CREATE INDEX idx_label_speech_entity ON LabelSpeech (LabelEntityRef)'
    );
    app.save(collection);

    collection = app.findCollectionByNameOrId('LabelText');
    collection.indexes = collection.indexes.filter(
      (idx) =>
        idx !== 'CREATE INDEX idx_label_text_track ON LabelText (LabelTrackRef)'
    );
    app.save(collection);

    collection = app.findCollectionByNameOrId('LabelObjects');
    collection.indexes = collection.indexes.filter(
      (idx) =>
        idx !==
        'CREATE INDEX idx_label_object_entity ON LabelObjects (LabelEntityRef)'
    );
    app.save(collection);

    collection = app.findCollectionByNameOrId('LabelPerson');
    collection.indexes = collection.indexes.filter(
      (idx) =>
        idx !==
        'CREATE INDEX idx_label_person_entity ON LabelPerson (LabelEntityRef)'
    );
    app.save(collection);

    collection = app.findCollectionByNameOrId('LabelFaces');
    collection.indexes = collection.indexes.filter(
      (idx) =>
        idx !==
        'CREATE INDEX idx_label_face_entity ON LabelFaces (LabelEntityRef)'
    );
    app.save(collection);

    collection = app.findCollectionByNameOrId('LabelTrack');
    collection.indexes = collection.indexes.filter(
      (idx) =>
        idx !==
        'CREATE INDEX idx_label_track_cluster ON LabelTrack (LabelEntityRef)'
    );
    app.save(collection);
  }
);
