# Video Ware

**A self-hosted video editor with a command line interface.**

Video Ware pairs a browser-based timeline editor with a CLI (`vw`) that can do
everything the editor can: ingest footage, find moments by what's said or
seen, cut clips, compose multi-track timelines, and render the result. That
makes video editing scriptable — by you, by a pipeline, or by an AI agent
editing on your behalf.

```bash
vw upload create raw/*.mp4                                  # ingest footage
vw label search "let's get started"                         # find moments by speech or visuals
vw label clip speech LABEL_ID --label "Cold open"           # turn a moment into a clip
vw timeline create "Episode 4" --tracks "Music,Interview,B-Roll"
vw timeline insert -t TIMELINE_ID --clips CLIP_ID --track 1
vw timeline render -t TIMELINE_ID --download episode-4.mp4
```

Humans get the same power visually: the web app has a full drag-and-drop
timeline editor over the same data, and CLI edits show up there in realtime.
Everything runs on your own hardware — your media never has to leave your
server.

## Features

- **Edit from the command line** — the `vw` CLI covers the entire workflow:
  upload, search, clip, compose, render. Designed for scripts and AI agents,
  with `vw workspace export` to dump context and `vw timeline doctor` to
  verify edits
- **A real editor in the browser** — multi-track drag-and-drop timeline,
  nested timelines, captions, and live preview, kept in sync with CLI edits
- **Searchable footage** — speech-to-text with speaker labels, plus optional
  visual analysis (objects, faces, people, shot changes) via Google Cloud
  Video Intelligence, so "find where she says…" is a one-line search
- **Fast previews** — thumbnails, scrub sprites, and proxy videos generated
  automatically on upload with FFmpeg
- **Render to file** — export any timeline to a finished video
- **Workspaces** — multi-user collaboration with role-based access
- **Your storage** — local disk or any S3-compatible bucket

## Quick start

The prebuilt Docker image bundles everything — web app, database, and worker —
in a single container:

```bash
docker run -d \
  --name video-ware \
  -p 8888:80 \
  -e POCKETBASE_ADMIN_EMAIL=admin@example.com \
  -e POCKETBASE_ADMIN_PASSWORD=your-secure-password \
  -v ./data:/data \
  ghcr.io/make-ware/video-ware:latest
```

Then open http://localhost:8888 and start uploading. For pinned versions,
split-service deployment with Docker Compose, and configuration options, see
the [deployment guide](docker/README.md).

### Get the CLI

```bash
brew tap make-ware/tap && brew install vw
vw login
```

Not on Homebrew? Every [GitHub
release](https://github.com/make-ware/video-ware/releases) ships a standalone
`vw` build. See the [CLI guide](cli/README.md) for details, the full command
reference, and the end-to-end agent editing flow.

## Developing locally

You'll need Node.js >= 22, Yarn 4 (via Corepack), FFmpeg, and Redis running on
`localhost:6379`.

```bash
git clone https://github.com/make-ware/video-ware
cd video-ware
yarn install
yarn setup          # downloads PocketBase, creates .env and the admin account
yarn build:shared   # build the shared package once
yarn dev            # web app :3000, PocketBase :8090, worker
```

The [development guide](docs/DEVELOPMENT.md) covers the rest: project layout,
schemas, migrations, and worker internals.

## How it's built

Video Ware is a Yarn workspaces monorepo:

- **`cli/`** — the `vw` command-line tool
- **`webapp/`** — the editor UI (Next.js 16, React 19, Tailwind)
- **`pb/`** — [PocketBase](https://pocketbase.io), providing the database,
  auth, and realtime updates
- **`worker/`** — a NestJS background worker that processes, analyzes, and
  renders media (BullMQ + Redis)
- **`shared/`** — types, Zod schemas, and utilities used everywhere

More docs: [Google Cloud Video Intelligence
configuration](docs/GCVI_CONFIGURATION.md) ·
[PocketBase guides](docs/)

## Contributing

Contributions are welcome! Set up a local environment as above, make your
changes on a branch, run `yarn precommit` (lint, typecheck, format, test), and
open a pull request. By contributing, you agree to the
[Contributor License Agreement](CLA.md).

## License

Video Ware is licensed under the **[GNU AGPL-3.0-only](LICENSE)**. You are free
to use, modify, and self-host it, including for commercial purposes. If you
modify Video Ware and distribute it or run it as a network service, you must
make your complete source code available to users under the same license.

The software is provided "as is", without warranty, and the authors are not
liable for any damages arising from its use.
