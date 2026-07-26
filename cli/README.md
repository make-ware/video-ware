# @project/cli (`vw`)

A Commander + TypeScript CLI for video-ware. It reuses `@project/shared`
mutators directly, so it stays in lockstep with the app's data model.

## Build & run

```bash
# shared must be built first (it is a workspace dependency)
yarn build:shared

# build the CLI, then run the binary
yarn workspace @project/cli build
node cli/dist/cli.js --help

# or run from source during development
yarn workspace @project/cli dev -- --help
```

## Install (released builds)

Every GitHub release attaches a standalone single-file build of the CLI
(`vw-<version>.tar.gz`) produced by `yarn workspace @project/cli bundle`
(`tsup.bundle.config.ts` — bundles all workspace and npm dependencies into
one script; requires Node.js >= 22 at runtime).

```bash
# from a GitHub release
curl -fsSL -o vw.tar.gz \
  "https://github.com/make-ware/video-ware/releases/download/video-ware-v<version>/vw-<version>.tar.gz"
tar -xzf vw.tar.gz
install -m 755 vw /usr/local/bin/vw

# via Homebrew
brew tap make-ware/tap
brew install vw
```

The release workflow (`.github/workflows/release-please.yml`,
`cli-release-asset` job) builds the bundle from the release tag, uploads the
tarball plus a `.sha256` checksum as release assets, and appends install
instructions to the release notes. If a `HOMEBREW_TAP_TOKEN` repository
secret is set (a token with push access to a `make-ware/homebrew-tap` repo),
it also commits an updated `Formula/vw.rb` to that tap on every release —
create the tap repo once and add the secret to enable it.

## Commands

```bash
vw login                       # authenticate (Users collection); caches a token
vw logout                      # clear the cached session

vw workspace list              # list workspaces (active marked with *)
vw workspace use [id]          # set the active workspace (interactive when omitted)
vw workspace export [dir]      # dump the workspace as JSON files (AI agent context)

vw upload create <file...>     # upload video/audio/image files as new media (default: `vw upload <file...>` works too)
vw upload list                 # list uploads by original file name (--status filters; --json for scripts)
vw upload replace <id> <file>  # overwrite the stored original of a media OR upload id with an updated source (--force)

vw media list                  # list media (--search/--type/-d narrow it; "/" = unfiled)
vw media search <query>        # search media by filename, label, or description (-d filters)
vw media update <id>           # set label/description, move into a directory (--directory)
vw media clip create           # create a media clip (sub-range of a media)
vw media clip list             # list media clips (-d filters via the parent media's directory)
vw media clip update <id>      # edit a media clip's label/description/trim
vw media clip delete <id>      # delete a media clip
vw media clip segments <id>    # show a clip's edit list (segments + gaps)
vw media clip split <id>       # split the edit list at source time(s) (--at)
vw media clip cut <id>         # remove a source range, e.g. an umm (--from/--to)
vw media clip trim <id>        # re-edge one edit-list segment (--segment -s -e)
vw media clip slip <id>        # slip source content ±seconds (--by, --segment)
vw media clip transcript <id>  # what the clip says — cut gaps trimmed at word level

vw dir list                    # list directories + media counts (optional flat folders)
vw dir show <dir>              # one directory and the media filed in it
vw dir create <name>           # create a directory (idempotent; path-safe names only)
vw dir rename <dir> <name>     # rename a directory
vw dir move <dir> <id...>      # file media into a directory ("/" or "none" unfiles them)
vw dir delete <dir>            # delete (refuses non-empty; --force unfiles the media first)

vw label search [query]        # search workspace labels (speech, objects, faces, …)
vw label list -m <mediaId>     # list labels for one media (--from/--to window; --clip/--timeline-clip = only what the clip plays)
vw label show <type> <id>      # show one label record (--clips lists linked clips)
vw label clip <type> <id>      # create a media clip from a label

vw caption create              # create a caption (subtitle) or title card
vw caption list                # list captions in the active workspace
vw caption show <id>           # show one caption (text, cues, style)
vw caption update <id>         # edit text/type/duration/style (updates placed clips)
vw caption delete <id>         # delete a caption (--force if placed on a timeline)

vw timeline list               # list timelines in the active workspace
vw timeline create <name>      # create a timeline (+ tracks via --tracks)
vw timeline update <id>        # update name/label/description/orientation
vw timeline show <id>          # inspect tracks, settings, and placed clips
vw timeline doctor <id>        # health-check: overlaps, gaps, stale durations
vw timeline inspect            # what plays on each track at --at <seconds>
vw timeline insert             # append media/MediaClips/captions/timelines to a track (--at/--after to place)
vw timeline compact <id>       # close gaps track-by-track (order preserved; --track scopes)
vw timeline render             # render a timeline and wait for the output

vw timeline track create       # add a track on the next layer up
vw timeline track list         # list tracks with settings and clip counts
vw timeline track update <ref> # volume/opacity/mute/lock/layer/name/label
vw timeline track delete <ref> # delete a track (--clips deletes its clips too)

vw timeline clips list         # list a timeline's clips with computed positions
vw timeline clips show <id>    # one clip + placement (--labels adds label data)
vw timeline clips update <id>  # label/description/trim/gain
vw timeline clips move <id>    # change track and/or timeline position
vw timeline clips ripple <id>  # shift a clip + everything after it by ±seconds
vw timeline clips remove <id>  # remove a clip (--ripple closes the gap)
vw timeline clips reorder ...  # replace the bookkeeping order (all clip ids)
vw timeline clips segments <id>  # show a clip's edit list (segments + source)
vw timeline clips split <id>   # split the edit list at source time(s) (--at)
vw timeline clips cut <id>     # remove a source range (--from/--to, --ripple)
vw timeline clips trim <id>    # re-edge one edit-list segment (--segment -s -e)
vw timeline clips slip <id>    # slip source content ±seconds (--by, --segment)
vw timeline clips transcript <id>  # what the clip says — cut gaps trimmed at word level
vw timeline clips map <id>     # translate a time: --source-time/--timeline-time/--offset

vw job label                   # (dev) queue label detection for a media (-t limits types)
vw job transcode               # (dev) queue transcode/preview regeneration (-a limits assets)
```

Any id omitted on the command line is chosen interactively.

### `-w/--workspace` — accepted on every command

`vw workspace use` sets the active workspace for the machine; `-w <id>`
overrides it for one invocation and is never persisted. The flag is registered
on **every** command (`src/lib/workspace-option.ts` walks the whole tree at
startup), so a script or agent can pass it uniformly without tracking which
commands are workspace-scoped — no command answers `-w` with "unknown option".

- Position doesn't matter: `vw -w ID media list`, `vw media -w ID list`, and
  `vw media list -w ID` are equivalent; the innermost `-w` wins.
- It takes an id, a slug, or a workspace name (like directory and entity refs).
  An unknown one is an error, not an empty result list.
- Workspace-scoped commands (`list`, `search`, `create`, `export`, …) act on it.
- Id-addressed commands (`vw media show <id>`, `vw timeline clips update <id>`)
  don't need it — record ids are globally unique — but where the record's
  workspace is loaded anyway (media, media clips, timelines) a `-w` that
  contradicts the record is refused rather than ignored.
- `vw workspace use -w ID` treats it as the positional, so it never falls back
  to the interactive picker.

## The agent editing flow

The CLI is designed around a linear flow an agent can follow end-to-end:

```bash
# 0. (Optional) Snapshot the workspace as local context
vw workspace export ./context

# 1. Search video-intelligence labels and turn the good ones into MediaClips
vw label search "sunset" --min-confidence 0.8
vw label clip speech LABEL_ID --label "Intro quote"
vw media clip list --search intro            # organize/verify the clip library

# 2. Create a timeline and organize tracks (layer 0 = bottom of the stack)
vw timeline create "Episode 4" --tracks "Music,Interview,B-Roll"
vw timeline track list -t TIMELINE_ID
vw timeline track update 0 -t TIMELINE_ID --volume 0.4   # duck the music bed

# 3. Append the core media (interview cuts in order, then the music bed)
vw timeline insert -t TIMELINE_ID --clips MC_ID1,MC_ID2,MC_ID3 --track 1
vw timeline insert -t TIMELINE_ID -m MUSIC_MEDIA_ID --track 0

# 4. Add and fine-tune b-roll at exact times
vw timeline insert -t TIMELINE_ID -m BROLL_ID --track 2 --at 12.5
vw timeline show TIMELINE_ID                 # verify the whole layout
vw timeline inspect -t TIMELINE_ID --at 14 --labels   # what plays at 14s?
vw timeline clips move CLIP_ID --at 16 --overwrite
vw timeline clips ripple CLIP_ID --by=-2.5   # pull this clip + later ones left
vw timeline clips update CLIP_ID --gain 0.5 -e 9

# 4b. Drop a title card / caption on an upper track (create, then place)
vw caption create --type title --text "Chapter 1" --duration 3   # → cap_id
vw timeline insert -t TIMELINE_ID --caption CAP_ID --track 3 --at 0

# 4c. Fine-tune dialogue in place (segment edits — no extra clips needed).
# Times are source-media seconds, the same time base as transcript words.
vw media clip cut MC_ID --from 12.3 --to 13.1     # drop an umm from the clip
vw timeline clips segments TC_ID                  # inspect a placed clip's edit list
vw timeline clips cut TC_ID --from 44.2 --to 45.0 --ripple   # cut + close the gap
vw timeline clips trim TC_ID --segment 1 -s 45.4  # nudge one segment's edge
vw timeline clips transcript TC_ID                # what the cut actually says (gaps trimmed)
vw timeline compact TIMELINE_ID --track 1         # close gaps a batch of edits left behind

# 5. Verify, then render
vw timeline doctor TIMELINE_ID               # no overlaps/gaps/dangling refs?
vw timeline render -t TIMELINE_ID --download out.mp4
```

Labels are optional everywhere: commands show label data as hints when it
exists (`LABEL` columns, `--labels` detail) and work normally when it doesn't.

## Workspace export

`vw workspace export [dir]` (default dir: `./vw-export`) snapshots the whole
workspace as a directory of JSON files so an AI agent can browse timelines,
media, media clips, and label data locally instead of paging through
`--json` commands:

```
INSTRUCTIONS.md         generated guide agents should read first
manifest.json           what was exported, when, and how much
workspace.json          the Workspace record
media/
  index.json            one row per media: name, type, duration, clipCount,
                        labelCounts
  <mediaId>/
    media.json          the Media record (expand.UploadRef.name = filename)
    clips/<clipId>.json one MediaClip per file (folder absent = none)
    labels/<type>/<labelId>.json
                        one label per file, foldered by type (absent = none);
                        attributed labels carry attributedEntity
                        { id, name, kind, via }
timelines/
  index.json            one row per timeline: name, duration, trackCount,
                        clipCount
  <timelineId>.json     same shape as `vw timeline show --json`
```

Everything is fetched through the shared mutators (all pages, not just the
first). Every entity is its own file holding a single record (the same shape
`vw ... --json` prints for that record); only the `index.json` files use the
`{ items, totalItems }` list shape. `INSTRUCTIONS.md` embeds the workspace id
plus real record ids in its examples so an agent can act on the snapshot
immediately.

The export is a read-only snapshot: mutations go through the `vw` commands
above, then re-running `export` into the same directory refreshes it in
place (files the exporter owns are replaced, so deleted records don't
linger; other files in the directory are left alone). A non-empty directory
that isn't a previous export is refused unless `--force` is passed.
`--no-labels` skips label data, `-w <id>` overrides the active workspace,
and `--json` prints the manifest instead of progress lines.

## Directories (optional media folders)

Directories organize, filter, and label media — nothing more. They are
**optional** and **flat** (no nesting): a media without one simply sits at
the workspace root, and every media command returns all media unless
`-d/--directory` narrows it. Nothing is stored "inside" a directory and
deleting one never deletes media.

- **Names are unique per workspace** (case-insensitive, DB-enforced) and
  **path-safe**: letters, digits, dashes, and underscores only, starting
  with a letter or digit (e.g. `hawaii`, `b-roll_2024`). `vw dir create` is
  idempotent — creating an existing name just returns it.
- **Refs are flexible.** Every `<dir>` argument accepts a name (`hawaii`,
  `/hawaii`) or a record id, matched case-insensitively with a
  unique-substring fallback.
- **`/` (or `root` / `none`) means "no directory".** As a filter it selects
  unfiled media (`vw media list -d /`); as a move target it unfiles
  (`vw dir move / MEDIA_ID`).
- **Filing media:** `vw dir move <dir> <mediaId...>` moves a batch;
  `vw media update <id> --directory <dir>` does one alongside other edits;
  `vw upload <file...> --directory <dir>` files new media at ingest (as does
  the webapp's upload dialog).
- **Media clips have no directory of their own** — they follow their parent
  media, so `vw media clip list -d <dir>` filters clips through the source
  media's directory.
- **Deletion is safe by default.** `vw dir delete` refuses while media is
  still filed in the directory; `--force` unfiles the media back to the
  workspace root first.

## Timeline placement semantics

- **Tracks are layers.** `layer 0` is the bottom of the visual stack; higher
  layers render on top. A timeline holds at most **4 tracks**. Tracks carry
  `volume` (0–1), `opacity` (0–1), `isMuted`, and `isLocked`; a muted track
  contributes no audio to the render.
- **`--track` accepts a layer number or a track record id.** Bare integers
  resolve against the timeline's layers (ambiguous/missing layers error), so
  `--track 2` means "the b-roll layer" without an id lookup.
- **Every clip has an explicit position.** All placement commands write
  `timelineStart`; there is no implicit "flow" state. (PocketBase number
  fields can't round-trip "unset" — an omitted value is stored and returned
  as `0` — so unpinned clips would all collapse onto 0s after a reload.)
- **`insert` appends by default.** Without a placement flag the clip lands
  at the end of the target track — the same position the webapp computes.
  `--after <clipId>` places right after that clip (and targets its track);
  `--at <seconds>` places at an exact time. `--clips id1,id2,…` appends a
  batch of MediaClips in order. Every insert reports where the clip landed.
- **`--at`/`--after` nudge by default.** If the requested time collides with
  an existing clip, the new clip is placed at the next free time and the
  command reports the nudge as a warning. Pass `--ripple` to instead land at
  the exact requested time and shift later clips right (gap-preserving,
  non-destructive), or `--overwrite` (with `--at`) to trim/remove whatever
  overlaps (like the editor's playhead insert). `--ripple` also works on
  `clips move`; the two flags are mutually exclusive.
- **`insert --source-timeline <id>` nests a timeline.** The inserted timeline
  plays as a single clip; `-s`/`-e` trim its own time axis, and its content
  is edited only in the source timeline. Inserts that would make a timeline
  contain itself (directly or transitively) are rejected. A full-span insert
  follows the source's live duration until trimmed (`clips update -s/-e`);
  `timeline reflow` heals drift after the source changes, and renders flatten
  the nested tree automatically.
- **Composite clips occupy their effective duration.** Everywhere placement
  is computed — `insert`, `clips move` (collisions, `--overwrite` trims,
  `--ripple` shifts), `clips ripple`, `compact`, duration healing — a clip
  with an edit list takes up its gap-skipping playback length, never its
  source span `end - start`. Table `SOURCE` columns show the outer span with
  a ` ◆N` marker when an N-segment edit list governs playback; `DUR` is
  always the effective length.
- **`clips ripple <id> --by <±s>`** shifts a clip and everything after it on
  its track, preserving spacing — leftward shifts clamp at the previous
  clip. `clips remove --ripple` closes the gap the removed clip leaves.
- **`timeline compact [id]` closes gaps; `timeline reflow` preserves them.**
  Compact walks each track in order and re-places every clip flush after the
  previous one (order preserved — fix play order first with `clips reorder`),
  resolving leftover gaps/overlaps after a batch of segment edits; it is
  idempotent, supports `--track`/`--dry-run`, and uses the same bulk-shift
  concurrency guards as ripple. Reflow is the opposite contract: it heals
  nested-timeline drift while keeping every gap where it is. Overlay tracks
  often keep gaps on purpose — scope compact with `--track`.
- **`--dry-run`** on `insert`, `clips move`, and `clips ripple` prints the
  full plan (placement, trims, removals, shifts) without writing anything.
- **Soft outcomes are structured warnings.** Every edit op returns a
  `warnings` array (see *JSON output for agents*): `warning`-level entries
  mean the outcome deviates from what was asked or is irreversible (`nudged`,
  `clamped`, `removed`, `stale-read`, `post-write-overlap`) and print as `⚠`
  lines on stderr; `notice`-level entries are the documented behavior of an
  explicit flag (`shifted-others` under `--ripple`, `trimmed` under
  `--overwrite`, `noop`). Warnings never change the exit code — pass
  `--strict` to exit 1 when any warning-level entry exists (and on
  `timeline render`, to refuse queueing while clips overlap).
- **No-ops skip the write.** Moving a clip to its exact current position,
  updating fields to their stored values, an already-matching reorder, or a
  segment edit that leaves the edit list unchanged writes nothing and
  reports `noop` — so a record's `updated` timestamp keeps meaning "content
  changed". (Healing a legacy clip that lacks an explicit
  `timelineStart`/track ref still writes the pin.)
- **Concurrent edits are detected, not clobbered.** Edit ops re-check the
  records they write right before writing; if another editor (webapp or a
  second CLI) changed one in between, the op re-plans once against the fresh
  state when the remote change touched *different* fields (reported as a
  `stale-read` warning), and aborts with an error when it touched the *same*
  fields or `meta` (one JSON column — a blind write would drop the other
  editor's keys). Pass `--force` to re-apply your change over the fresh
  state anyway. Bulk shifts (`clips ripple`, `clips remove --ripple`) verify
  the whole shift group before the first write lands, so a re-plan or
  `--force` never re-applies a relative shift on top of a partial one.
  After writing, ops re-check the track and warn (`post-write-overlap`) if
  the final state has a same-track overlap involving the touched clips.
- **`timeline doctor <id>`** verifies the layout: same-track overlaps
  (errors), dangling media/caption refs (errors), clips pointing at deleted
  tracks and duplicate track layers (errors), stale stored durations
  (warnings), and gaps (info). It exits non-zero when errors exist, so
  agents can use it as an "am I done" gate. `timeline show` also warns
  inline when a track has overlapping clips.
- **`order` is bookkeeping, not placement.** It gives clips a stable listing
  sequence; positions come from `timelineStart` alone.
- **`track update --layer N` swaps** with the track currently holding layer N,
  keeping layers unique (two sequential updates, not a transaction).
- **Durations self-heal.** Every clip mutation recomputes the timeline's
  duration as the furthest clip end across tracks and persists it.
  `timeline show` displays the computed value and flags a stale stored one.

## Segment editing (dialogue fine-tuning)

`split` / `cut` / `trim` / `slip` / `segments` exist identically under
`media clip` and `timeline clips`. They edit a clip's **edit list** — an
ordered array of `{start, end}` source-media ranges — so umms and dead words
can be removed in place instead of shredding the library into hundreds of
tiny clips.

- **All times are source-media seconds**, the same time base as stored
  segments and transcript word times, so an agent can cut straight from a
  `label search` result.
- **The edit list IS the composite marker — `type` never changes.** A clip
  is composite exactly when its edit list has 2+ segments; `type` stays the
  clip's origin (`user`, `shot`, `face`, …) no matter how it's edited. The
  first edit on a plain MediaClip seeds the list from its trim window; a
  TimelineClip gets its own `meta.segments` copy — initialized from the
  referenced composite MediaClip when there is one — and from then on
  **stops following later edits to that MediaClip** (`segments` shows which
  source a clip uses).
- **Single-segment lists collapse (auto-revert).** An edit that leaves
  exactly one segment removes the list and writes plain `start`/`end`
  instead — cutting a clip back down to one range un-composites it. The one
  exception: a timeline clip whose source MediaClip has its own edit list
  keeps a 1-segment `meta.segments` as a mask (removing it would bring the
  source's cuts back).
- **`segments <id> --clear` is the explicit revert.** On a MediaClip it
  removes the edit list (the trim window is kept). On a timeline clip it
  removes the `meta.segments` override — playback reverts to the source
  MediaClip's edit list when it has one, else to the plain trim;
  `--ripple`/`--dry-run` are supported.
- **Inserting a composite MediaClip carries its edits along.**
  `timeline insert --clip` stores the effective duration and the render
  expands the segments; fine-tune the placed copy with `timeline clips`
  segment commands without touching the library clip.
- **`start`/`end`/`duration` are derived, never hand-written.** Every write
  recomputes them from the segments; `duration` is the effective
  (gap-skipping) playback length, not `end - start`. `update -s/-e` on a
  composite intersects the edit list with the new window — and collapses the
  clip back to a plain trim when only one segment survives the window.
- **Edits are validated and normalized.** Segments stay sorted and
  ms-rounded, overlaps merge, edits can't cross neighboring segments or the
  media bounds, and no edit may create a segment shorter than 0.1s or cut
  away all remaining content. `slip` clamps and reports requested vs
  applied.
- **`--ripple` (on `timeline clips cut`/`trim`)** shifts the clips after the
  edited one by the duration change so the cut closes up; without it,
  later clips keep their absolute positions. `--dry-run` works on every
  segment command.
- **`--json` result fields:** `converted` means an edit list was created on
  a previously-plain clip; `collapsed` means the edit left one segment and
  the list was removed (plain start/end again).
- Both the webapp preview player and the render skip edit-list gaps — what
  you preview is what renders.

### The three time domains

Composite clips make three distinct time bases meet; every command names
them consistently so agents never conflate them:

- **`src` (source-media seconds)** — positions in the media file. Stored
  segments, transcript/label times, and all segment-edit inputs live here.
- **`clip` (clip-effective seconds)** — the gap-skipping playback offset;
  `0` is the clip's first visible frame. A composite's effective duration is
  the sum of its windowed segments, not `end - start`.
- **`tl` (timeline seconds)** — absolute position on the timeline. For a
  placed clip, `tl = placement start + clip offset`.

Every clip-showing command (`clips show/list`, `timeline show/inspect`,
`media clip list`, `segments`, `transcript`) embeds one canonical `times`
block in its JSON:

```jsonc
"times": {
  "timeline":  { "start": 4.2, "end": 14.8, "duration": 10.6 }, // placed clips only
  "source":    { "start": 1.8, "end": 31.1, "span": 29.3 },     // trim window (outer span)
  "effective": { "duration": 10.6 },                            // gap-skipping playback length
  "segments":  { "count": 4, "source": "meta" },                // 'meta'|'mediaClip'|'clipData'|'trim'
  "composite": true                                             // count >= 2 governs playback
}
```

`segments` is omitted for caption and nested-timeline clips (their windows
are already linear); `count: 1, source: "meta"` is a mask over a composite
source MediaClip; `composite` is true only when 2+ segments govern playback.

**Point translations — `vw timeline clips map <id>`** answers "where does
this moment land" through the edit list, from any one of the three domains:

```bash
vw timeline clips map TC_ID --source-time 92.4   # label hit → timeline position
vw timeline clips map TC_ID --timeline-time 14.9 # playhead → source position
vw timeline clips map TC_ID --offset 6.1         # clip offset → both
```

The result reports the moment in all three domains plus the edit-list
segment it falls in (`segment` IDX matches the `segments` command). A source
time inside a cut gap reports `inGap` + the gap range and collapses to the
boundary the playhead skips to; inputs outside the played content clamp
(`clamped: true`).

**Batch translations — `regions` in `clips show --json`**: each placed
media clip carries its continuous playback runs
`[{ index, timelineStart, timelineEnd, sourceStart, sourceEnd }]` — the
complete piecewise-linear source↔timeline mapping in one call (segments that
touch in source time coalesce into one run, so `regions.length` may be
smaller than `segments.count`).

### Clip transcripts (edit-list aware)

`vw media clip transcript <id>` / `vw timeline clips transcript <id>` answer
"what does this clip actually say" — utterances are trimmed to the clip's
**windowed edit list at word level**, so text sitting in a cut gap never
appears and a 40s mid-take cut can't mislead an audit:

```
Clip TC_ID — transcript from speaker labels (2 segment(s), effective 10.20s, span 1.80–52.00s of media M_ID)
  timeline: 30.00–40.20s (track layer 1) — edit list source: meta
  [src 2.10–6.60s | clip 0.30–4.80s | tl 30.30–34.80s] Speaker 1 (Erik): we should open on the premise
  ── cut: 40.00s of source removed ──
  [src 46.80–48.30s | clip 5.00–6.50s | tl 35.00–36.50s] Speaker 1 (Erik): and end on the ask
  (2 utterance(s) hidden entirely by cuts; 87 word(s) omitted — `segments` shows the gaps)
```

- **Speaker labels are preferred** (diarized, usually the better
  transcription); speech labels are the automatic fallback when no speaker
  rows overlap. `--type speaker|speech` forces one source.
- **Word keep rule:** a word is kept iff it overlaps a kept segment — a word
  straddling a cut edge counts as inside (partially audible), matching the
  caption/render rule, so transcript, subtitles, and render agree.
- An utterance spanning a cut splits into per-segment parts; its `text`
  joins them with `[cut N.Ns]` markers (source seconds removed).
- `--full-text` prints only the flowing speaker-labeled text (one utterance
  per line) — the audit surface for "does each beat open on its own
  premise". `--json` returns the full structure; `--words` adds per-word
  timing arrays (omitted by default to keep payloads small).
- Utterances without stored word timings fall back to evenly-spread
  estimates and are flagged (`estimatedTimings`, plus a stderr `⚠`) — cut
  filtering on those is approximate.

**Labels through the same lens:** `clips show --labels` /
`timeline inspect --labels` intersect overlapping labels with the windowed
edit list — labels wholly inside cut gaps are dropped (reported as a
`hiddenInCutGaps` count) and survivors carry `played` ranges projected into
clip and timeline time. `vw label list` accepts `--from/--to` (source-time
window) and `--clip <mediaClipId>` / `--timeline-clip <id>` to list only the
labels a clip actually plays.

### Examples

```bash
vw media search beach                          # media matching "beach" (filename/label/description)
vw media update MEDIA_ID \
  --label "Beach intro" --description "Opening drone shot"  # name/annotate a media
vw dir list                                    # directories are optional flat folders (with media counts)
vw dir create hawaii                           # create a directory (idempotent; path-safe names only)
vw media list --directory hawaii               # only media filed under "hawaii" (name or id)
vw media list -d /                             # only unfiled media (workspace root)
vw dir move hawaii M_ID1 M_ID2                 # file several media at once
vw dir move none M_ID1                         # unfile (back to the workspace root)
vw media update MEDIA_ID --directory hawaii    # file one media (--directory none clears it)
vw media clip list -d hawaii                   # clips whose source media is in that directory
vw dir rename hawaii hawaii-2024               # rename (unique per workspace)
vw dir delete hawaii --force                   # delete; filed media are unfiled, never deleted
vw media clip create -m MEDIA_ID -s 5 -e 12.5  # USER clip of media[5s..12.5s]
vw media clip create -m MEDIA_ID --type range  # whole-media clip, typed "range"
vw media clip create -m MEDIA_ID -s 5 -e 12.5 \
  --label "Beach intro" --description "Opening shot"
vw media clip list -m MEDIA_ID                 # clips derived from one media
vw media clip list --type shot                 # clips of a given type
vw media clip list --search beach              # match label/description/type/filename
vw media clip update MC_ID --label "Beach intro" --description "Opening shot"
vw media clip update MC_ID -s 6 -e 14           # re-trim (revalidated against the source media)
vw media clip delete MC_ID                      # delete; dangling MediaClipRefs are provenance-only

vw label search "sunset"                       # all label types, best confidence first
vw label search hello -t speech,text           # transcript/on-screen-text matches only
vw label search --face-id F123 --json          # exact faceId match, full records
vw label search dog -m MEDIA_ID --min-confidence 0.8
vw label list -m MEDIA_ID -t speech            # one media's speech labels, by start time
vw label list -m MEDIA_ID --from 40 --to 60    # only labels overlapping 40–60s
vw label list --timeline-clip TC_ID -t speaker # only what the placed clip plays (gaps hidden)
vw label show face LABEL_ID --clips            # one label + clips created from it
vw label clip speech LABEL_ID                  # clip from the label's time range
vw label clip face LABEL_ID --label "Hero face"

vw timeline create "Ep 4" --tracks "Music,AV,B-Roll" --label "Rough cut"
vw timeline insert -t TIMELINE_ID -m MEDIA_ID --start 0 --end 12.5  # appends
vw timeline insert -t TIMELINE_ID --clip MEDIACLIP_ID --track 1  # inherits trim+label
vw timeline insert -t TIMELINE_ID --clips MC1,MC2,MC3 --track 1  # batch append
vw timeline insert -t TIMELINE_ID --clip MEDIACLIP_ID --after CLIP_ID
vw timeline insert -t TIMELINE_ID -m MEDIA_ID --track 2 --at 5 --gain 0.5
vw timeline insert -t TIMELINE_ID -m MEDIA_ID --at 5 --overwrite --dry-run
vw timeline track update 0 -t TIMELINE_ID --volume 0.3 --muted
vw timeline track update TRACK_ID --opacity 0.8 --layer 2        # swaps layers
vw timeline clips list -t TIMELINE_ID --track 2
vw timeline clips move CLIP_ID --track 1 --at 8 --overwrite
vw timeline clips ripple CLIP_ID --by=-2.5    # pull clip + later clips left
vw timeline clips remove CLIP_ID --ripple     # delete and close the gap
vw timeline clips transcript CLIP_ID --full-text  # audit what the cut says
vw timeline clips map CLIP_ID --source-time 92.4  # label hit → timeline position
vw timeline compact TIMELINE_ID --dry-run     # preview the gap-closing moves
vw timeline doctor TIMELINE_ID                # verify layout invariants
vw timeline inspect -t TIMELINE_ID --at 6 --labels
vw timeline render -t TIMELINE_ID --resolution 1280x720 --download out.mp4
vw timeline render -t TIMELINE_ID --fps 24    # output frame rate (default 30)
vw timeline render -t TIMELINE_ID --no-wait   # queue only, don't poll
```

## Captions and title cards

Captions are on-screen text overlays. There are two kinds, distinguished by
`--type`:

- **`caption`** (default) — a subtitle-style overlay (small, bottom, boxed).
- **`title`** — a title card (large, centered, bold) for chapter titles,
  lower-thirds, and intro/outro cards.

Both are the same data model the webapp editor uses, so a caption created here
shows up in the editor and vice-versa. The flow is two steps — **create** the
caption, then **place** it on a timeline track — mirroring `media clip create`
→ `timeline insert --clip`:

```bash
# 1. Create a title card (5s by default; --type title = big centered text)
vw caption create --type title --text "Chapter 1: Arrival" --duration 3
#   ✓ Created title cap_xxx "Chapter 1: Arrival" (3.00s)

# 2. Place it on a track like any other clip — all insert flags apply
vw timeline insert -t TIMELINE_ID --caption cap_xxx --track 2 --at 0
vw timeline insert -t TIMELINE_ID --caption cap_xxx --track 2 --at 0 --overwrite
```

A caption becomes a normal timeline clip (`CaptionRef`), so **every placement
flag works the same** as for media: `--at`/`--after`/append, `--overwrite`,
`--dry-run`, `--track`, `--label`. `--start`/`--end` trim the caption's own cue
timeline rather than a source media. Put title cards and captions on their own
upper track so they overlay the video below.

Captions render only when the timeline is rendered with captions enabled
(`includeCaptions`, on by default) — distinct from auto speech-to-text
subtitles (`includeSubtitles`, off by default).

```bash
vw caption create --text "Filmed in Iceland"            # subtitle-style caption
vw caption create --type title --text "The End" --duration 4 --position middle
vw caption create --type title --text "Big News" \
  --font-size 120 --color "#FFCC00" --position top       # tweak the preset style
vw caption create --text "Line one\nLine two" --duration 6 --animate
                                                          # split lines into timed cues
vw caption create --text "Custom" --style '{"fontSize":72,"bold":true,"outline":true}'
                                                          # full style as JSON (flags override)

vw caption list                                          # ad-hoc captions in the workspace
vw caption list --include-transcripts                    # include media transcript captions
vw caption show cap_xxx                                  # text, cues, and resolved style
vw caption update cap_xxx --text "Chapter 1: Departure"  # updates every clip that uses it
vw caption update cap_xxx --type title                   # re-base style on the title preset
vw caption delete cap_xxx                                # refuses if placed; --force overrides
```

Style flags (`--font-size`, `--color`, `--bg-color`, `--bg-opacity`,
`--position top|middle|bottom`, `--align left|center|right`) layer on top of the
type's default preset; `--style <json>` sets a full base and the individual
flags override it. `--animate` splits the text (one cue per line, else per
sentence) evenly across the duration; without it the whole text shows for the
clip's length. Editing a caption updates every timeline clip that references it,
so a title-card typo is one `caption update` away — no re-placement needed.

## Label search

`vw label search` fans out one query per label type and merges the results
best-confidence-first. What the free-text query matches depends on the type:

| type      | collection    | query matches (`~`)              | exact-id flag |
| --------- | ------------- | -------------------------------- | ------------- |
| `speech`  | LabelSpeech   | `transcript`                     | —             |
| `speaker` | LabelSpeaker  | `transcript, speakerId`          | —             |
| `text`    | LabelText     | `text`                           | —             |
| `object`  | LabelObjects  | `entity`                         | `--track-id`  |
| `shot`    | LabelShots    | `entity`                         | —             |
| `segment` | LabelSegments | `entity`                         | —             |
| `person`  | LabelPerson   | `upperBodyColor, lowerBodyColor` | `--person-id` |
| `face`    | LabelFaces    | `faceId`                         | `--face-id`   |

Person and face rows carry opaque ids rather than descriptive text, so the
exact-id flags are the primary path for those types (each implies its label
type; combining one with a conflicting `--types` is an error).

Every label output resolves the label's attributed real-world entity live
(`vw entity` / `vw label tag` write those links): tables carry an `ENTITY`
column, speaker text renders as `Speaker 1 (Erik)`, `label show` prints an
`entity:` line, and JSON documents embed an
`attributedEntity: { id, name, kind, via }` object (`via` says which link
point resolved it: the label's own `track`, or its provider `cluster`).
The field is simply absent when a label hasn't been attributed.

`vw label clip <type> <labelId>` copies the label's time range onto a new
MediaClip (type mapped from the label type) **and** writes a `MediaClipLabels`
join row, so the clip back-references its source label even after the clip is
edited. `vw label show <type> <labelId> --clips` walks that edge in reverse.

## Lists: filtering, sorting, pagination

Every `list`/`search` command shares one contract, so what you learn on one
applies to all of them. The flags are registered from a single declarative spec
per list (`cli/src/lib/list/`), which is also what generates the `--help` text
and the footers below.

| Flag | Meaning |
| --- | --- |
| `-n, --limit <count>` | rows per page (default **100**; 200 on `media list`, `media clip list`, `caption list`, `timeline list`, `upload list` — their pre-pagination page size; max 500) |
| `--page <n>` | which page to show (default 1) |
| `--sort <field>` | ordering; the valid names are listed in each command's `--help` |
| `--all` | fetch every page instead of one |
| `--json` | machine-readable output, nothing else on stdout |
| `-w, --workspace <id>` | workspace override (on workspace-scoped lists) |

A page ends with a footer saying where you are and how to reach the rest:

```
$ vw media list
ID     NAME        TYPE   DURATION
…
(1–100 of 3412 — next page: vw media list --page 2)
(narrow instead: --type <mediaType>, --search <text>, -d/--directory <dir>)
(add --json for full records; `vw media show <id>` for one record)
```

On the last page the first line reads `end of results` (or `all results shown`
when a single page held everything), so "is there more?" never requires
guessing.

**Narrowing beats paging.** The second line appears only while pages remain,
and lists the filters you have *not* used. Applying one is nearly always better
than walking pages — fewer requests, and a smaller result to read. That is also
why a few lists require a filter up front rather than scanning a whole
workspace:

- `vw label search` needs a query, `--entity`, or an exact-id flag
- `vw label list` needs `-m <mediaId>` (in a terminal it offers a picker
  instead; off a TTY it fails with the flag name, so an agent gets an error
  rather than a hanging prompt)
- `vw timeline clips list` / `vw timeline track list` need `-t <timelineId>`

Sort names match the webapp's sort menus (`recent`, `name`, `duration`,
`media_time`), so `--sort recent` means the same thing in both.

**Whole-object lists.** `vw timeline clips list` and `vw timeline track list`
describe one timeline's structure, which callers read entire — a clip's
computed timeline position depends on the clips before it. They therefore
return everything by default; `-n`/`--page` window that view when you want a
slice.

**Merged lists.** `vw label search`, `vw label list`, and `vw entity labels`
query all eight label collections and present the union, so one page costs
`page × --limit` rows *from each*. Depth is capped (`--max-depth`, default 500
rows per collection); past it the command says so and points at `-t <type>` — a
single label type needs no merge and pages without a bound.

### Migration notes (breaking changes)

Scripts written against the pre-pagination CLI should check two flags whose
meaning changed — both fail silently (fewer or different rows, no error):

- **`caption list --all` no longer includes transcript captions.** `--all` now
  means "fetch every page" on every list, like everywhere else in the CLI. The
  old behavior — including media-attached transcript captions — moved to
  `--include-transcripts`. A saved `vw caption list --all` now pages through
  ad-hoc captions only; add `--include-transcripts` to get the old result set.
- **`--limit` on merged label lists now caps the merged total, not each
  type.** `label search`/`label list`/`entity labels` previously applied
  `--limit` (default 20) *per label type*, so `--limit 50` could return up to
  50 × 8 rows. It now bounds the merged page, so `--limit 50` returns at most
  50 rows across all types; page or `--all` for the rest, or narrow with
  `-t <type>`.

Default page sizes are otherwise preserved: lists that previously read a fixed
200 rows (`media list`, `media clip list`, `caption list`, `timeline list`,
`upload list`) keep 200 as their default `--limit`.

## JSON output for agents

List/search commands print a concise table by default and end with the footer
above. Add `--json` to get a machine-readable document on stdout with nothing
else:

- lists → the page plus its cursor:

  ```json
  {
    "items": [...],
    "totalItems": 3412,
    "page": 1,
    "perPage": 100,
    "totalPages": 35,
    "hasMore": true,
    "nextPage": 2,
    "nextCommand": "vw media list --json --page 2",
    "appliedFilters": [],
    "availableFilters": ["directory", "type", "search"]
  }
  ```

  Follow `nextCommand` while `hasMore` is true (it is the invoking command line
  with `--page` replaced, so your other flags are preserved), or narrow using
  `availableFilters` — usually the better move. `hasMore` is `false` and
  `nextPage`/`nextCommand` are `null` on the last page and under `--all`.
  `items`/`totalItems` keep their pre-pagination meaning, so existing scripts
  that read only those two keys are unaffected.

  `label search`/`label list` (and `entity labels`) items are
  `{ "type": "<labelType>", "record": {...} }` wrappers, plus
  `attributedEntity: { id, name, kind, via }` when the label is attributed to
  an entity; `timeline clips list` items carry the clip plus computed
  `timelineStart`/`timelineEnd`, `labelHint`, `kind`, `layer`, and the
  canonical `times` block; `media clip list` items carry `times` too;
  `upload list` items carry `mediaId` when the upload has been ingested
- `label list --clip/--timeline-clip` adds `editList: { segments, source }`
  and `hiddenInCutGaps` to the envelope. A clip's outer span is the server-side
  window, but "overlaps a played segment" can only be decided in memory, so
  this scope always reads every page — `totalItems` is the count of labels that
  actually play, not the count the window matched. `-n`/`--page` still window
  what is shown, applied to the surviving rows
- **the canonical `times` block** (see *The three time domains*) appears on
  every clip-shaped JSON output: `{ timeline?, source, effective, segments?,
  composite }`. **Breaking:** `segments --json` `times` now uses this shape —
  the old `{start, end, duration}` values live on as `times.source.start/end`
  and `times.effective.duration`; the inspection also gains `placement` for
  timeline clips
- `clips show` → `{ clip, placement, times, regions?, labels? }`; `regions`
  is the piecewise source↔timeline mapping table (placed media clips only)
- `clips map` → `{ clipId, timelineId, layer, input: { domain, value },
  point: { timeline, offset, source, segment }, inGap, gap?, clamped,
  composite, times }`
- `clips transcript` / `media clip transcript` → `{ clipId, domain, mediaId,
  labelType: "speaker"|"speech"|null, labelTypeSelected, editListSource,
  segments, gaps, times, placement?, utterances, totals, text }`; utterances
  carry `speaker { speakerId?, label, entity? }`, per-part `src/clip/tl`
  ranges, `omittedWords`, and `estimatedTimings`; `totals` counts kept words,
  omitted words, and utterances hidden entirely by cuts
- `--labels` blocks → `{ provenance, overlapping, hiddenInCutGaps }`;
  `overlapping` rows carry `played: [{ sourceStart, sourceEnd, clipStart,
  clipEnd, timelineStart?, timelineEnd? }]` — only what the clip actually
  plays (gap-only labels are dropped and counted)
- `timeline compact` → `{ timelineId, tracks: [{ trackId, layer, moves,
  closedGapSeconds }], moveCount, applied, dryRun, warnings }`
- `label show` → the raw record (plus `attributedEntity` when attributed,
  and a `links` array with `--clips`)
- `label clip` → the raw created clip record (`clipData.sourceId` holds the
  source label id)
- `timeline show` → `{ timeline, computedDuration, clipCount, tracks: [{
  track, layer, clips: [{ clip, timelineStart, timelineEnd, labelHint,
  kind }] }] }`
- `timeline inspect` → `{ at, computedDuration, tracks: [{ layer, trackId,
  trackName, volume, opacity, isMuted, isLocked, active, nextStart }] }`;
  `active` carries the full clip record plus `sourceTime`/`remaining`, and a
  `labels: { provenance, overlapping }` block with `--labels` (both rows
  carry `attributedEntity` when the label is attributed to an entity)
- `timeline insert` / `clips move` → the full placement result: `clip`
  (null on `--dry-run`), `placedAt`/`placedEnd`, `mode`
  (`append`/`after`/`at`, insert only), `afterClip`, `requestedAt`,
  `nudged`, `trims`, `trimmedClipIds`, `removedClipIds`, `shifted`
  (`--ripple` moves), `noop` (move only), `dryRun`, `track`, `warnings`;
  batch `insert --clips` wraps the per-clip results in
  `{ items, totalItems }`
- **every edit result carries `warnings`**: an array of `{ level:
  "warning"|"notice", code, message, clipIds, data? }` with codes `nudged`,
  `clamped`, `shifted-others`, `trimmed`, `removed`, `noop`, `stale-read`,
  `post-write-overlap`. Ops that can skip the write also carry a top-level
  `noop` boolean. Agents should check `warnings` after every edit; pass
  `--strict` to turn warning-level entries into exit 1.
- `clips update` → `{ clip, noop, warnings }` (previously the raw clip
  record)
- `clips ripple` → `{ track, by, requestedBy, shifted: [{ clipId, from,
  to }], noop, dryRun, warnings }` (`by` differs from `requestedBy` when
  clamped)
- `clips remove` → `{ clip, shifted, warnings }`; `clips reorder` →
  `{ items, totalItems, noop, warnings }`
- `timeline doctor` → `{ timelineId, timelineName, computedDuration,
  clipCount, trackCount, findings: [{ level, code, message, clipIds,
  layer }], errors, warnings, ok }`; the process exits non-zero when
  `ok` is false

Non-interactive callers (AI agents, scripts) should always pass explicit ids
(`-m`, `-t`, `-w`, positional ids) — commands fall back to interactive pickers
when an id is omitted, which blocks without a TTY. `-w` is accepted by every
command and `-t` by every timeline/clips command: where an id is redundant it is
validated against the target record instead of rejected (see
[`-w/--workspace`](#-w--workspace--accepted-on-every-command)).

## Adding command options

Optional record fields are exposed through declarative **option groups**
(`src/lib/options.ts`). A group maps commander flags 1:1 onto a lib-level
options object: `applyOptions` registers the flags on a command,
`pickOptions` extracts the parsed values under the same keys, and
`satisfies OptionGroupOf<TheOptions>` locks keys and value types to the
options interface at compile time.

To expose a new MediaClip field on `media clip create`:

1. Add the field to `CreateMediaClipOptions` and map it into the mutator
   input in `createMediaClip` (`src/lib/media.ts`).
2. Add a matching spec to `clipFieldOptions` in the same file (a `parse`
   function turns the raw flag string into a typed, validated value).

The command wires itself — it already spreads
`pickOptions(opts, clipFieldOptions)` into `createMediaClip`. The same group
can be reused by future commands (e.g. `clip update`).

Don't declare `-w/--workspace` on a command: `installWorkspaceOption`
(`src/lib/workspace-option.ts`) registers it across the tree in `buildProgram`,
and workspace-scoped commands read it through `resolveWorkspaceId(pb)` with no
plumbing. New commands are covered automatically — the test in
`src/__tests__/workspace-option.test.ts` fails if one isn't.

## Uploading media

`vw upload` has three subcommands: `create` (new media), `list` (browse
existing uploads), and `replace` (overwrite an existing source). Replace is
deliberately its own subcommand because it is destructive.

`vw upload create <file...>` sends local video/audio/image files through the
same Next.js route the webapp uses (`/api-next/uploads/upload`), in
sequential 100 MB chunks so Cloudflare-fronted deployments work. Finishing
the upload triggers ingest automatically: the worker creates the Media
record and generates the proxy/thumbnails. `create` is the default intent,
so plain `vw upload <file...>` still works.

```bash
vw upload create beach.mp4                 # upload into the active workspace
vw upload create *.mp4 --directory hawaii  # several files, filed into a directory
vw upload create clip.mp4 --json           # machine-readable result (agents)
```

The command returns as soon as the file is uploaded — ingest (transcode,
thumbnails) continues in the worker and can take a while; check progress
with `vw media list`.

The route lives on the **webapp** origin. In the monolith deployment one
origin serves both PocketBase (`/api/`) and the webapp (`/api-next/`), so no
extra configuration is needed. When the two differ (e.g. split local dev),
set the webapp origin explicitly — precedence: `--app-url` flag →
`appUrl` in the config file (written by `vw login --app-url`) →
`$VW_APP_URL` → derived from the PocketBase URL (a PB URL on
`localhost:8090` maps to `http://localhost:3000`).

### Listing uploads

`vw upload list` (alias `ls`) shows the workspace's uploads by their **original
file name** — the name the file was uploaded as, which the Media it produced
can be relabelled away from. Each row carries the upload id, status, size, and
the id of the Media ingested from it (`—` when none has been, so it doubles as
an "did this finish ingesting?" check). Newest first.

```bash
vw upload list                     # all uploads in the active workspace
vw upload list --status failed     # only failed uploads
vw upload list -n 20               # cap the rows
vw upload list --json              # {items,totalItems}; media column omitted
```

The upload id in each row is exactly what `vw upload replace` accepts, so a
bulk-replace script is a `--json` list piped through `jq` to map local
filenames to ids.

### Replacing an existing media's file

`vw upload replace <mediaOrUploadId> <file>` overwrites the stored **original**
of an already-ingested source with an updated file (e.g. a re-graded or
re-mixed version), through the same `/api-next/uploads/replace` route the
webapp's replace page uses. The Media and Upload records are untouched, so
nothing is re-ingested: previews (thumbnail, proxy, sprite, filmstrip) and
detected labels keep reflecting the old file until regenerated from the media
details page. The replacement must be the same kind of media (video for video,
etc.); ideally its duration and dimensions match the original.

The id may be **either a media id or an upload id** — whichever a script has on
hand. A media id is tried first, then an upload id; the dry report (below)
names which was resolved and the exact upload that will be overwritten, so you
can confirm before committing. This makes bulk replaces from a mixed list of
ids safe to script.

The overwrite is destructive and cannot be undone, so the command refuses to
run without `--force` — without it, it only reports what would be replaced.

```bash
vw upload replace m9x2xkq31bkfrq1 final_v2.mp4          # media id, dry report, refuses
vw upload replace m9x2xkq31bkfrq1 final_v2.mp4 --force  # actually overwrite
vw upload replace u1a2b3c4d5e6f7g final_v2.mp4 --force  # an upload id works too
```

### Dev job triggers

`vw job …` is a developer/admin escape hatch that queues the same worker
tasks the webapp and the ingest pipeline create — useful after a
`vw upload replace`, a worker bug fix, or a new detector rollout. A running
worker is required; the CLI only creates the Task record.

- `vw job label -m <mediaId>` queues a `detect_labels` task. `-t/--types`
  restricts it (e.g. `-t speech,speaker`); the requested types are intent
  only — the worker's `ENABLE_*` env flags gate what actually runs.
- `vw job transcode -m <mediaId>` queues a `process_upload` task that
  regenerates derived assets from the stored original. `-a/--assets`
  restricts it (e.g. `-a proxy,sprite`); by default it regenerates everything
  that applies to the media type, with the same settings a fresh ingest uses.

## Configuration

State is stored at `~/.config/video-ware/config.json` (URL, webapp origin for
uploads, auth token, active workspace). The PocketBase URL defaults to
`$POCKETBASE_URL` and can be set with `vw login --url`; the webapp origin
(only needed when it differs from the PocketBase URL) with
`vw login --app-url`.

## How rendering works

`vw timeline render` creates a `TimelineRenders` record. A PocketBase hook turns
that into a `render_timeline` task that the worker picks up automatically; the
CLI then polls the same record for `status`/`progress` and prints the output
file URL when it finishes.
