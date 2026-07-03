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

## Commands

```bash
vw login                       # authenticate (Users collection); caches a token
vw logout                      # clear the cached session

vw workspace list              # list workspaces (active marked with *)
vw workspace use [id]          # set the active workspace (interactive when omitted)
vw workspace export [dir]      # dump the workspace as JSON files (AI agent context)

vw media list                  # list media in the active workspace
vw media search <query>        # search media by filename, label, or description
vw media update <id>           # set a media's editor-facing label/description
vw media clip create           # create a media clip (sub-range of a media)
vw media clip list             # list media clips in the active workspace

vw label search [query]        # search workspace labels (speech, objects, faces, …)
vw label list                  # list labels for one media
vw label show <type> <id>      # show one label record (--clips lists linked clips)
vw label clip <type> <id>      # create a media clip from a label

vw timeline list               # list timelines in the active workspace
vw timeline create <name>      # create a timeline (+ tracks via --tracks)
vw timeline update <id>        # update name/label/description/orientation
vw timeline show <id>          # inspect tracks, settings, and placed clips
vw timeline inspect            # what plays on each track at --at <seconds>
vw timeline insert             # add media (or a MediaClip) to a timeline track
vw timeline render             # render a timeline and wait for the output

vw timeline track create       # add a track on the next layer up
vw timeline track list         # list tracks with settings and clip counts
vw timeline track update <ref> # volume/opacity/mute/lock/layer/name/label
vw timeline track delete <ref> # delete a track (--clips deletes its clips too)

vw timeline clips list         # list a timeline's clips with computed positions
vw timeline clips show <id>    # one clip + placement (--labels adds label data)
vw timeline clips update <id>  # label/description/trim/gain
vw timeline clips move <id>    # change track and/or timeline position
vw timeline clips remove <id>  # remove a clip (order renumbers densely)
vw timeline clips reorder ...  # replace the sequential order (all clip ids)
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

# 3. Insert the core media (interview, montage, music) sequentially
vw timeline insert -t TIMELINE_ID --clip MEDIACLIP_ID --track 1
vw timeline insert -t TIMELINE_ID -m MUSIC_MEDIA_ID --track 0

# 4. Add and fine-tune b-roll at exact times
vw timeline insert -t TIMELINE_ID -m BROLL_ID --track 2 --at 12.5
vw timeline show TIMELINE_ID                 # verify the whole layout
vw timeline inspect -t TIMELINE_ID --at 14 --labels   # what plays at 14s?
vw timeline clips move CLIP_ID --at 16 --overwrite
vw timeline clips update CLIP_ID --gain 0.5 -e 9

# 5. Render
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
    clips.json          MediaClips cut from this media (absent = none)
    labels/<type>.json  labels of one type, by start time (absent = none)
timelines/
  index.json            one row per timeline: name, duration, trackCount,
                        clipCount
  <timelineId>.json     same shape as `vw timeline show --json`
```

Everything is fetched through the shared mutators (all pages, not just the
first), list files use the same `{ items, totalItems }` shape as `--json`
output, and `INSTRUCTIONS.md` embeds the workspace id plus real record ids
in its examples so an agent can act on the snapshot immediately.

The export is a read-only snapshot: mutations go through the `vw` commands
above, then re-running `export` into the same directory refreshes it in
place (files the exporter owns are replaced, so deleted records don't
linger; other files in the directory are left alone). A non-empty directory
that isn't a previous export is refused unless `--force` is passed.
`--no-labels` skips label data, `-w <id>` overrides the active workspace,
and `--json` prints the manifest instead of progress lines.

## Timeline placement semantics

- **Tracks are layers.** `layer 0` is the bottom of the visual stack; higher
  layers render on top. A timeline holds at most **4 tracks**. Tracks carry
  `volume` (0–1), `opacity` (0–1), `isMuted`, and `isLocked`; a muted track
  contributes no audio to the render.
- **`--track` accepts a layer number or a track record id.** Bare integers
  resolve against the timeline's layers (ambiguous/missing layers error), so
  `--track 2` means "the b-roll layer" without an id lookup.
- **Clips place sequentially unless pinned.** A clip without `timelineStart`
  butts up against the preceding clips on its track (ordered by `order`). A
  clip with `timelineStart` (set via `--at`) sits at that absolute time.
  Clips on the same track never overlap.
- **`--at` nudges by default.** If the requested time collides with an
  existing clip, the new clip is placed at the next free time and the command
  reports the actual placement. Pass `--overwrite` to instead trim/remove
  whatever overlaps (like the editor's playhead insert).
- **`clips move --sequential`** clears a clip's pin so it re-flows by order.
- **`track update --layer N` swaps** with the track currently holding layer N,
  keeping layers unique (two sequential updates, not a transaction).
- **Durations self-heal.** Every clip mutation recomputes the timeline's
  duration as the furthest clip end across tracks and persists it.
  `timeline show` displays the computed value and flags a stale stored one.

### Examples

```bash
vw media search beach                          # media matching "beach" (filename/label/description)
vw media update MEDIA_ID \
  --label "Beach intro" --description "Opening drone shot"  # name/annotate a media
vw media clip create -m MEDIA_ID -s 5 -e 12.5  # USER clip of media[5s..12.5s]
vw media clip create -m MEDIA_ID --type range  # whole-media clip, typed "range"
vw media clip create -m MEDIA_ID -s 5 -e 12.5 \
  --label "Beach intro" --description "Opening shot"
vw media clip list -m MEDIA_ID                 # clips derived from one media
vw media clip list --type shot                 # clips of a given type
vw media clip list --search beach              # match label/description/type/filename

vw label search "sunset"                       # all label types, best confidence first
vw label search hello -t speech,text           # transcript/on-screen-text matches only
vw label search --face-id F123 --json          # exact faceId match, full records
vw label search dog -m MEDIA_ID --min-confidence 0.8
vw label list -m MEDIA_ID -t speech            # one media's speech labels, by start time
vw label show face LABEL_ID --clips            # one label + clips created from it
vw label clip speech LABEL_ID                  # clip from the label's time range
vw label clip face LABEL_ID --label "Hero face"

vw timeline create "Ep 4" --tracks "Music,AV,B-Roll" --label "Rough cut"
vw timeline insert -t TIMELINE_ID -m MEDIA_ID --start 0 --end 12.5
vw timeline insert -t TIMELINE_ID --clip MEDIACLIP_ID --track 1  # inherits trim+label
vw timeline insert -t TIMELINE_ID -m MEDIA_ID --track 2 --at 5 --gain 0.5
vw timeline track update 0 -t TIMELINE_ID --volume 0.3 --muted
vw timeline track update TRACK_ID --opacity 0.8 --layer 2        # swaps layers
vw timeline clips list -t TIMELINE_ID --track 2
vw timeline clips move CLIP_ID --track 1 --at 8 --overwrite
vw timeline inspect -t TIMELINE_ID --at 6 --labels
vw timeline render -t TIMELINE_ID --resolution 1280x720 --download out.mp4
vw timeline render -t TIMELINE_ID --no-wait   # queue only, don't poll
```

## Label search

`vw label search` fans out one query per label type and merges the results
best-confidence-first. What the free-text query matches depends on the type:

| type      | collection    | query matches (`~`)              | exact-id flag |
| --------- | ------------- | -------------------------------- | ------------- |
| `speech`  | LabelSpeech   | `transcript`                     | —             |
| `text`    | LabelText     | `text`                           | —             |
| `object`  | LabelObjects  | `entity`                         | `--track-id`  |
| `shot`    | LabelShots    | `entity`                         | —             |
| `segment` | LabelSegments | `entity`                         | —             |
| `person`  | LabelPerson   | `upperBodyColor, lowerBodyColor` | `--person-id` |
| `face`    | LabelFaces    | `faceId`                         | `--face-id`   |

Person and face rows carry opaque ids rather than descriptive text, so the
exact-id flags are the primary path for those types (each implies its label
type; combining one with a conflicting `--types` is an error).

`vw label clip <type> <labelId>` copies the label's time range onto a new
MediaClip (type mapped from the label type) **and** writes a `MediaClipLabels`
join row, so the clip back-references its source label even after the clip is
edited. `vw label show <type> <labelId> --clips` walks that edge in reverse.

## JSON output for agents

List/search commands print a concise table by default and end with a
`(… add --json for full records)` hint. Add `--json` to get a machine-readable
document on stdout with nothing else:

- lists → `{ "items": [...], "totalItems": N }` — `label search`/`label list`
  items are `{ "type": "<labelType>", "record": {...} }` wrappers;
  `timeline clips list` items carry the clip plus computed
  `timelineStart`/`timelineEnd`, `labelHint`, `kind`, and `layer`
- `label show` → the raw record (plus a `links` array with `--clips`)
- `label clip` → the raw created clip record (`clipData.sourceId` holds the
  source label id)
- `timeline show` → `{ timeline, computedDuration, clipCount, tracks: [{
  track, layer, clips: [{ clip, timelineStart, timelineEnd, labelHint,
  kind }] }] }`
- `timeline inspect` → `{ at, computedDuration, tracks: [{ layer, trackId,
  trackName, volume, opacity, isMuted, isLocked, active, nextStart }] }`;
  `active` carries the full clip record plus `sourceTime`/`remaining`, and a
  `labels: { provenance, overlapping }` block with `--labels`
- `timeline insert` / `clips move` → the full placement result
  (`clip`, `placedAt`, `requestedAt`, `nudged`, `trimmedClipIds`,
  `removedClipIds`)

Non-interactive callers (AI agents, scripts) should always pass explicit ids
(`-m`, `-t`, `-w`, positional ids) — commands fall back to interactive pickers
when an id is omitted, which blocks without a TTY.

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
