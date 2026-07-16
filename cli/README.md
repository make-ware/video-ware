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

# via Homebrew (requires the tap to be published, see below)
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

vw media list                  # list media (-d/--directory optionally filters; "/" = unfiled)
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

vw dir list                    # list directories + media counts (optional flat folders)
vw dir show <dir>              # one directory and the media filed in it
vw dir create <name>           # create a directory (idempotent; path-safe names only)
vw dir rename <dir> <name>     # rename a directory
vw dir move <dir> <id...>      # file media into a directory ("/" or "none" unfiles them)
vw dir delete <dir>            # delete (refuses non-empty; --force unfiles the media first)

vw label search [query]        # search workspace labels (speech, objects, faces, …)
vw label list                  # list labels for one media
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
vw timeline insert             # append media/MediaClips/captions to a track (--at/--after to place)
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
```

Any id omitted on the command line is chosen interactively. `--workspace <id>`
overrides the active workspace for a single command.

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
  `vw media update <id> --directory <dir>` does one alongside other edits.
  Uploads made in the webapp can also land in a directory at ingest.
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
  command reports the nudge. Pass `--overwrite` (with `--at`) to instead
  trim/remove whatever overlaps (like the editor's playhead insert).
- **`clips ripple <id> --by <±s>`** shifts a clip and everything after it on
  its track, preserving spacing — leftward shifts clamp at the previous
  clip. `clips remove --ripple` closes the gap the removed clip leaves.
- **`--dry-run`** on `insert`, `clips move`, and `clips ripple` prints the
  full plan (placement, trims, removals, shifts) without writing anything.
- **`timeline doctor <id>`** verifies the layout: same-track overlaps
  (errors), dangling media/caption refs (errors), stale stored durations
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
ordered array of `{start, end}` source-media ranges (a composite clip) — so
umms and dead words can be removed in place instead of shredding the library
into hundreds of tiny clips.

- **All times are source-media seconds**, the same time base as stored
  segments and transcript word times, so an agent can cut straight from a
  `label search` result.
- **First edit auto-converts.** A plain MediaClip becomes `type: composite`
  with its trim window as the first segment. A TimelineClip gets its own
  `meta.segments` copy — initialized from the referenced composite MediaClip
  when there is one — and from then on **stops following later edits to that
  MediaClip** (`segments` shows which source a clip uses).
- **Inserting a composite MediaClip carries its edits along.**
  `timeline insert --clip` stores the effective duration and the render
  expands the segments; fine-tune the placed copy with `timeline clips`
  segment commands without touching the library clip.
- **`start`/`end`/`duration` are derived, never hand-written.** Every write
  recomputes them from the segments; `duration` is the effective
  (gap-skipping) playback length, not `end - start`. `update -s/-e` on a
  composite intersects the edit list with the new window.
- **Edits are validated and normalized.** Segments stay sorted and
  ms-rounded, overlaps merge, edits can't cross neighboring segments or the
  media bounds, and no edit may create a segment shorter than 0.1s or cut
  away all remaining content. `slip` clamps and reports requested vs
  applied.
- **`--ripple` (on `timeline clips cut`/`trim`)** shifts the clips after the
  edited one by the duration change so the cut closes up; without it,
  later clips keep their absolute positions. `--dry-run` works on every
  segment command.
- **Preview caveat:** the webapp preview player currently plays composite
  clips straight through (gaps included); renders skip the gaps. Use
  `timeline render` to hear the final cut.

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
vw timeline doctor TIMELINE_ID                # verify layout invariants
vw timeline inspect -t TIMELINE_ID --at 6 --labels
vw timeline render -t TIMELINE_ID --resolution 1280x720 --download out.mp4
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
vw caption list --all                                    # include media transcript captions
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

## JSON output for agents

List/search commands print a concise table by default and end with a
`(… add --json for full records)` hint. Add `--json` to get a machine-readable
document on stdout with nothing else:

- lists → `{ "items": [...], "totalItems": N }` — `label search`/`label list`
  (and `entity labels`) items are `{ "type": "<labelType>", "record": {...} }`
  wrappers, plus `attributedEntity: { id, name, kind, via }` when the label
  is attributed to an entity; `timeline clips list` items carry the clip
  plus computed `timelineStart`/`timelineEnd`, `labelHint`, `kind`, and
  `layer`
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
  `nudged`, `trims`, `trimmedClipIds`, `removedClipIds`, `track`, `dryRun`;
  batch `insert --clips` wraps the per-clip results in
  `{ items, totalItems }`
- `clips ripple` → `{ track, by, requestedBy, shifted: [{ clipId, from,
  to }], dryRun }` (`by` differs from `requestedBy` when clamped)
- `clips remove` → `{ clip, shifted }`; `clips reorder` →
  `{ items, totalItems }`
- `timeline doctor` → `{ timelineId, timelineName, computedDuration,
  clipCount, trackCount, findings: [{ level, code, message, clipIds,
  layer }], errors, warnings, ok }`; the process exits non-zero when
  `ok` is false

Non-interactive callers (AI agents, scripts) should always pass explicit ids
(`-m`, `-t`, `-w`, positional ids) — commands fall back to interactive pickers
when an id is omitted, which blocks without a TTY. `-w` and `-t` are accepted
uniformly across the timeline/clips commands: where an id is redundant it is
validated against the target record instead of rejected.

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

## Configuration

State is stored at `~/.config/video-ware/config.json` (URL, auth token, active
workspace). The PocketBase URL defaults to `$POCKETBASE_URL` and can be set with
`vw login --url`.

## How rendering works

`vw timeline render` creates a `TimelineRenders` record. A PocketBase hook turns
that into a `render_timeline` task that the worker picks up automatically; the
CLI then polls the same record for `status`/`progress` and prints the output
file URL when it finishes.
