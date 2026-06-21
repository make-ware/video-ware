/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// Backfill Files.MediaRef (ad-hoc / manual)
//
// Files (proxy, filmstrip, sprite, thumbnail, audio, ...) cascade-delete with
// their Media via Files.MediaRef (see the Files_media_cascade migration). New
// files set MediaRef at creation time in the worker; this job links OLDER files
// that predate that, by walking each Media's own relation fields and pointing
// the referenced File back at the Media.
//
// Runs once a week ("0 0 * * 0" = 00:00 every Sunday). It's idempotent and cheap
// when there's nothing to link, so a weekly sweep is a safe backstop. You can
// also trigger it on demand from the PocketBase dashboard -> Crons ->
// "backfillFileMediaRefs" -> Run.
// ---------------------------------------------------------------------------

const BACKFILL_SINGLE_REFS = [
  'proxyFileRef',
  'spriteFileRef',
  'thumbnailFileRef',
  'audioFileRef',
];

cronAdd('backfillFileMediaRefs', '0 0 * * 0', () => {
  // Link a single File -> Media if it isn't linked yet. Returns 1 if it wrote.
  const linkFile = (fileId, mediaId) => {
    if (!fileId) return 0;
    let file;
    try {
      file = $app.findRecordById('Files', fileId);
    } catch (_) {
      return 0; // file already gone
    }
    if (file.get('MediaRef')) return 0; // already linked
    file.set('MediaRef', mediaId);
    $app.save(file);
    return 1;
  };

  const limit = 500;
  let offset = 0;
  let linked = 0;

  while (true) {
    // We only modify Files here, never Media, so offset paging is stable.
    const mediaRecords = $app.findRecordsByFilter(
      'Media',
      "id != ''",
      '',
      limit,
      offset
    );
    if (!mediaRecords || mediaRecords.length === 0) break;

    for (const media of mediaRecords) {
      const mediaId = media.id;
      for (const field of BACKFILL_SINGLE_REFS) {
        linked += linkFile(media.get(field), mediaId);
      }
      const strips = media.get('filmstripFileRefs') || [];
      for (const fileId of strips) {
        linked += linkFile(fileId, mediaId);
      }
    }

    if (mediaRecords.length < limit) break;
    offset += limit;
  }

  console.log(
    `backfillFileMediaRefs: linked ${linked} file(s) to their Media`
  );
});
