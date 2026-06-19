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

vw media list                  # list media in the active workspace
vw media search <query>        # search media by upload filename
vw media clip create           # create a media clip (sub-range of a media)
vw media clip list             # list media clips in the active workspace

vw timeline list               # list timelines in the active workspace
vw timeline insert             # add media to a timeline
vw timeline render             # render a timeline and wait for the output
```

Any id omitted on the command line is chosen interactively. `--workspace <id>`
overrides the active workspace for a single command.

### Examples

```bash
vw media search beach                          # media whose filename matches "beach"
vw media clip create -m MEDIA_ID -s 5 -e 12.5  # USER clip of media[5s..12.5s]
vw media clip create -m MEDIA_ID --type range  # whole-media clip, typed "range"
vw media clip list -m MEDIA_ID                 # clips derived from one media
vw media clip list --type shot                 # clips of a given type

vw timeline insert -t TIMELINE_ID -m MEDIA_ID --start 0 --end 12.5
vw timeline render -t TIMELINE_ID --resolution 1280x720 --download out.mp4
vw timeline render -t TIMELINE_ID --no-wait   # queue only, don't poll
```

## Configuration

State is stored at `~/.config/video-ware/config.json` (URL, auth token, active
workspace). The PocketBase URL defaults to `$POCKETBASE_URL` and can be set with
`vw login --url`.

## How rendering works

`vw timeline render` creates a `TimelineRenders` record. A PocketBase hook turns
that into a `render_timeline` task that the worker picks up automatically; the
CLI then polls the same record for `status`/`progress` and prints the output
file URL when it finishes.
