---
name: verify
description: Drive the local video-ware stack end-to-end to verify worker/render/CLI changes — start PocketBase + worker, build a timeline with the vw CLI, render, and inspect the output with ffprobe/ffmpeg.
---

# Verifying video-ware changes end-to-end (local stack)

The render surface is: `vw` CLI → PocketBase (Tasks record) → worker poller →
BullMQ → executors → finalize (upload back to PB). All of it runs locally.

## Recipe that works

```bash
yarn build:shared                                    # required before worker build
yarn workspace @project/worker build

# 1. PocketBase (serves repo pb/pb_data on 127.0.0.1:8090) — background
cd pb && ./pocketbase serve

# 2. Worker — background. Root .env is loaded via ConfigModule (envFilePath ../.env).
#    REDIS_URL with a /db suffix isolates BullMQ state from other dev sessions
#    (safe: tasks flow via a PB poller, not Redis, so any redis db works).
cd worker && LOG_LEVEL=debug REDIS_URL=redis://localhost:6379/7 node dist/main
# Render knobs: RENDER_MAX_INPUTS_PER_PASS (default 24) forces the bounded
# multi-pass path when set low (e.g. 2); RENDER_WINDOW_SEC (default 60).

# 3. CLI — ALWAYS sandbox $HOME: ~/.config/video-ware/config.json points at
#    PRODUCTION (video.makeware.io). Login creds live in root .env (VW_EMAIL/VW_PASSWORD).
export HOME=<scratch>/vwhome
vw login --url http://127.0.0.1:8090 --email "$VW_EMAIL" --password "$VW_PASSWORD"
vw workspace use bhupyj56quigmzt        # local dev workspace with real 4K media

# 4. Build a timeline and render
vw timeline create "name"                                # prints timeline id + track 0
vw timeline insert -t <tl> -m <mediaId> -s 0 -e 6        # append media clip (source trim)
vw timeline track create -t <tl> --name Titles           # captions need a second track
vw caption create --text "..." -d 10 --json              # returns caption id
vw timeline insert -t <tl> --caption <cap> --track 1 --at 2
vw timeline render -t <tl> --resolution 1920x1080 --timeout 900 --download out.mp4
```

## Inspect

- Worker log: `Timeline graph: N ffmpeg inputs`, `Bounded multi-pass render: …`
  (only above the cap), per-window `Rendering window i/N` at debug.
- `ffprobe -count_frames` for exact duration/frame count; compare two renders
  with `ffmpeg -i a.mp4 -i b.mp4 -lavfi ssim -f null -` (≥0.99 = visually equal).
- Extract frames: `ffmpeg -ss <t> -i out.mp4 -frames:v 1 f.png` and Read the png.
- Render intermediates land in `data/renders/<ws>/<task>/` and are deleted by
  finalize — check mid-render if you need to see `parts/`.

## Gotchas

- There is no `vw media upload`, `vw workspace create`, or `vw timeline delete` —
  use the existing dev workspace/media; test timelines stay behind.
- `vw timeline insert --track 1` fails until `vw timeline track create` adds layer 1.
- Worker startup warns about GCVI config if Google creds are absent — harmless.
- Kill PB and the worker when done; they hold ports 8090/3001/3002.
