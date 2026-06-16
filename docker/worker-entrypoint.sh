#!/bin/sh
set -e

# =============================================================================
# Entrypoint for the standalone worker image.
#
# The worker reads/writes media under WORKER_DATA_DIR (default /data/storage),
# which is typically a bind-mounted volume shared with PocketBase. Bind mounts
# keep the HOST directory's ownership, so if it is root-owned the unprivileged
# `nextjs` user cannot write and media processing fails with permission errors.
#
# When started as root we chown the storage dir to nextjs and then drop to that
# user via `su-exec` so the long-running worker process is unprivileged. When
# already started as a non-root user we run in place — chown would fail and is
# unnecessary if the volume is already writable. This mirrors the ownership
# self-heal the monolith performs in start.sh and PocketBase does in
# pocketbase-entrypoint.sh.
# =============================================================================

WORKER_DATA_DIR="${WORKER_DATA_DIR:-/data/storage}"

mkdir -p "$WORKER_DATA_DIR"

RUN_AS=""
if [ "$(id -u)" = "0" ]; then
    chown -R nextjs:nodejs "$WORKER_DATA_DIR" 2>/dev/null \
        || echo "⚠️  Could not chown $WORKER_DATA_DIR — writes may fail if the mounted volume is not writable by uid 1001 (nextjs)." >&2
    RUN_AS="su-exec nextjs"
fi

# Replace the shell with the worker so signals (SIGTERM) propagate correctly.
# $RUN_AS is intentionally unquoted so it word-splits into `su-exec nextjs`
# (or expands to nothing when already non-root).
exec $RUN_AS node worker/dist/main.js
