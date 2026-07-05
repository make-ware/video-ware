Root cause, confirmed
Exactly as the feedback diagnosed: PocketBase number fields can't round-trip "unset" — an omitted timelineStart comes back as 0, so every "sequential" insert stacked at the head of the track, and move --sequential's null write was silently coerced back to 0. The webapp never hit this because it always computes and writes an explicit position. The CLI now does the same: every clip is always written with an explicit timelineStart (Option B — the schema and webapp are untouched).

What changed
Placement (timeline.ts, timeline-clip.ts)

insert appends to the end of the target track by default (same math as the webapp's computeClipPlacement), and always reports where the clip landed: ✓ Inserted clip … at 10.00–15.00s on track 1 (appended after "BROLL.mov")
insert --after <clipId> pins at that clip's end (targets its track, nudges past collisions with a report); --at/--overwrite unchanged
insert --clips id1,id2,id3 batch-appends MediaClips in order — one command per act instead of 5–7
clips ripple <id> --by <±s> shifts a clip plus everything after it (leftward shifts clamp at the previous clip); clips remove --ripple closes the gap
clips move --sequential is removed — it never worked and there's no unpinned state anymore
--dry-run on insert, move, and ripple prints the full plan (placement, trims, removals) without writing
Verification surface (timeline-doctor.ts, timeline.ts)

vw timeline doctor <id> — overlaps (error), dangling media/caption refs (error), stale durations (warning), gaps (info, with the exact ripple command to close each). Exits non-zero on errors, so it works as an agent's "am I done" gate
timeline show now prints !! N clips overlap … per track, so the corruption you found can't hide again
Consistency: -w/-t accepted across show/doctor/all clips subcommands (validated when redundant, per the INSTRUCTIONS.md advice); --json added to clips remove/reorder; the export-generated INSTRUCTIONS.md and README rewritten for the new model.