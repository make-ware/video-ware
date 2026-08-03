/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// Make "delete a Media" always possible: drop `required` from the four label
// refs a cascade cannot satisfy.
//
// Deleting a Media fans out through the cascade closure set up by
// 1781900000_cascade_media_children: Media -> MediaClips, Files, LabelEntity,
// LabelTrack, LabelFaces, LabelObjects, LabelPerson, LabelSegments, LabelShots,
// LabelSpeech, LabelSpeaker, LabelText, LabelJobs, Captions, MediaTags,
// MediaClipLabels. LabelEntity and LabelTrack are IN that set (their MediaRef
// cascades), and the leaf label rows point back at them.
//
// PocketBase resolves a reference to a record it is deleting one of two ways:
// cascadeDelete -> delete the referrer; otherwise -> UNSET the reference and
// save the referrer. It cannot unset a `required` field, so it aborts the whole
// delete with:
//
//   the record cannot be deleted because it is part of a required reference
//   in record <id> (LabelFaces collection)
//
// which is exactly what a user hit deleting a media with face labels. The leaf
// rows would have been cascade-deleted moments later via their own MediaRef,
// but PocketBase iterates the referencing collections in map order, so whether
// the delete succeeds depended on which collection it happened to reach first —
// the delete was failing nondeterministically, not consistently.
//
// Four fields carry `required: true` with `cascadeDelete: false` into that
// closure. All four are the odd ones out: the same refs on LabelSegments,
// LabelShots, LabelSpeaker, LabelSpeech, LabelText and LabelTrack have always
// been optional.
//
//   LabelFaces.LabelEntityRef    -> LabelEntity
//   LabelObjects.LabelEntityRef  -> LabelEntity
//   LabelPerson.LabelEntityRef   -> LabelEntity
//   LabelPerson.LabelTrackRef    -> LabelTrack
//
// Relaxing (not cascading) is deliberate. A LabelEntity is also deleted on its
// own — by hook-label-entity-gc when its last label row goes away, and by hand
// from the dashboard — and legacy workspace-wide LabelEntity rows predating
// 1785110401 can still be shared across media. Cascading would make deleting
// one media delete another media's detections; unsetting only drops the entity
// attribution on rows that survive, which is what the label pages already
// render (`LabelEntityRef` is optional in every consumer).
//
// Writers are unaffected: the worker's step processors always set both refs and
// the Zod *input* schemas still demand them — this only widens what the DB
// accepts so a cascade can clear them.
//
// The matching source-of-truth change is `.optional()` on those fields in
// shared/src/schema/label-face.ts, label-objects.ts and label-person.ts, with
// shared/src/schema/__tests__/media-delete-cascade.test.ts asserting no
// required non-cascade reference ever points into the closure again.
// ---------------------------------------------------------------------------
migrate(
  (app) => {
    // required alone drives non-emptiness on a relation; minSelect is already 0
    // on all four fields and stays there.
    const labelFaces = app.findCollectionByNameOrId("LabelFaces");
    const facesEntityRef = labelFaces.fields.getByName("LabelEntityRef");
    facesEntityRef.required = false;
    app.save(labelFaces);

    const labelObjects = app.findCollectionByNameOrId("LabelObjects");
    const objectsEntityRef = labelObjects.fields.getByName("LabelEntityRef");
    objectsEntityRef.required = false;
    app.save(labelObjects);

    const labelPerson = app.findCollectionByNameOrId("LabelPerson");
    const personEntityRef = labelPerson.fields.getByName("LabelEntityRef");
    personEntityRef.required = false;
    const personTrackRef = labelPerson.fields.getByName("LabelTrackRef");
    personTrackRef.required = false;
    app.save(labelPerson);
  },
  (app) => {
    // Reverting re-wedges Media deletes for any media carrying face, object or
    // person labels. Rows whose refs were already unset by a cascade are NOT
    // re-validated by PocketBase, so they stay blank and re-block the next
    // delete that touches them.
    const labelFaces = app.findCollectionByNameOrId("LabelFaces");
    const facesEntityRef = labelFaces.fields.getByName("LabelEntityRef");
    facesEntityRef.required = true;
    app.save(labelFaces);

    const labelObjects = app.findCollectionByNameOrId("LabelObjects");
    const objectsEntityRef = labelObjects.fields.getByName("LabelEntityRef");
    objectsEntityRef.required = true;
    app.save(labelObjects);

    const labelPerson = app.findCollectionByNameOrId("LabelPerson");
    const personEntityRef = labelPerson.fields.getByName("LabelEntityRef");
    personEntityRef.required = true;
    const personTrackRef = labelPerson.fields.getByName("LabelTrackRef");
    personTrackRef.required = true;
    app.save(labelPerson);
  }
);
