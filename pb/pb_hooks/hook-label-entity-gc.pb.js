/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// LabelEntity garbage collection
//
// A LabelEntity is the record OF a detection: "this media contains this
// speaker / this face track / a 'mountain' label". Since the per-instance
// migration, the MediaEntities and EntityStats views read those rows directly
// instead of walking the label rows — one hop instead of eight, and it finally
// covers shots and segments. The cost of that shortcut is that a LabelEntity
// outliving its labels keeps claiming a detection that no longer exists:
// delete a media's transcript rows in the webapp and the entity would still be
// listed on that media, with `links` counting a row nothing points at.
//
// Media deletion is already covered — LabelEntity.MediaRef cascades — so this
// hook is about the finer-grained deletes: one utterance, one track, a row
// removed from the dashboard or straight through the API.
//
// The check is cheap because LabelEntity is typed: only LabelTrack and the ONE
// leaf collection matching its labelType can point at it, so a delete costs two
// existence checks, not nine.
//
// Deliberately NOT collected: a LabelEntity with no MediaRef. Those are the
// legacy workspace-wide rows the per-instance migration could not resolve —
// the recovery net, not garbage.
// ---------------------------------------------------------------------------

onRecordAfterDeleteSuccess(
  (e) => {
    // Everything the handler needs lives inside it: PocketBase runs each
    // handler in an isolated goja runtime, so the file's top-level scope is
    // gone by the time this fires.
    const LEAF_BY_TYPE = {
      object: "LabelObjects",
      shot: "LabelShots",
      person: "LabelPerson",
      speech: "LabelSpeech",
      speaker: "LabelSpeaker",
      face: "LabelFaces",
      segment: "LabelSegments",
      text: "LabelText",
    };

    /** Whether any row in `collection` still points at this LabelEntity. */
    const hasReferrer = (collection, entityId) => {
      try {
        const rows = $app.findRecordsByFilter(
          collection,
          "LabelEntityRef = {:entity}",
          "",
          1, // one hit is enough to keep the entity alive
          0,
          { entity: entityId }
        );
        return rows.length > 0;
      } catch (error) {
        // An unreadable collection counts as "still referenced": keeping a row
        // that could have been collected is harmless; deleting one still in
        // use is not.
        console.error(
          "label-entity-gc: referrer check failed for " + collection + ":",
          error
        );
        return true;
      }
    };

    try {
      const entityId = e.record.get("LabelEntityRef");
      if (!entityId) return;

      // Already gone (cascade from Media, or a sibling delete in the same
      // request got here first) — nothing to collect.
      let entity;
      try {
        entity = $app.findRecordById("LabelEntity", entityId);
      } catch (notFound) {
        return;
      }

      if (!entity.get("MediaRef")) return; // legacy row: leave it be

      const leaf = LEAF_BY_TYPE[entity.get("labelType")];
      if (!leaf) return; // unknown type: leave it alone rather than guess

      if (hasReferrer("LabelTrack", entityId)) return;
      if (hasReferrer(leaf, entityId)) return;

      $app.delete(entity);
      console.log(
        "label-entity-gc: removed orphaned LabelEntity " +
          entityId +
          " (" +
          entity.get("labelType") +
          ")"
      );
    } catch (error) {
      // Never block a label delete over bookkeeping: a stale entity row is a
      // cosmetic overcount, a wedged delete is not.
      console.error("label-entity-gc: failed to collect LabelEntity:", error);
    } finally {
      e.next();
    }
  },
  "LabelTrack",
  "LabelObjects",
  "LabelShots",
  "LabelPerson",
  "LabelSpeech",
  "LabelSpeaker",
  "LabelFaces",
  "LabelSegments",
  "LabelText"
);
