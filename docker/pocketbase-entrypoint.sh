#!/bin/sh
set -e

# =============================================================================
# Entrypoint for the standalone PocketBase image.
#
# Ensures a superuser exists (create-or-update) BEFORE serving, so split-pod
# deployments (e.g. Kubernetes, where PocketBase, the worker and the webapp run
# as separate containers) boot without any manual admin creation.
#
# The worker authenticates against the _superusers collection at startup
# (PocketBaseService.connect -> authWithPassword). On a fresh data dir there is
# no superuser, so the worker can never authenticate and crash-loops. Seeding
# the superuser here is what unblocks the worker.
# =============================================================================

PB_BIN="${PB_BIN:-/app/pb/pocketbase}"
PB_DATA_DIR="${PB_DATA_DIR:-/data/pb_data}"
PB_MIGRATIONS_DIR="${PB_MIGRATIONS_DIR:-/app/pb/pb_migrations}"
PB_HOOKS_DIR="${PB_HOOKS_DIR:-/app/pb/pb_hooks}"
PB_HTTP="${PB_HTTP:-0.0.0.0:8090}"

# No defaults for POCKETBASE_ADMIN_EMAIL/PASSWORD on purpose: the superuser step
# below has to be able to tell "the operator supplied credentials" from "nobody
# did", and a default would make every deployment look configured - with a
# password published in this repository.
PB_LOG_SERVICE=pocketbase
PB_APP_USER=nextjs:nodejs

mkdir -p "$PB_DATA_DIR"

# =============================================================================
# Ownership model (no su-exec / no runtime chown).
#
# This image runs as the unprivileged `nextjs` user (uid/gid 1001) via `USER`
# in the Dockerfile. Because the superuser upsert and `serve` below both run as
# 1001, any database files they create are owned by 1001 — so PocketBase can
# always write them. This avoids the "attempt to write a readonly database (8)"
# (SQLite SQLITE_READONLY) failure that occurs when root creates the DB files
# and an unprivileged process then tries to write them.
#
# The only requirement is that the mounted /data is writable by uid 1001:
#   * named volumes  -> inherit the image's 1001 ownership automatically;
#   * bind mounts    -> chown the host dir once: `chown -R 1001:1001 <hostdir>`.
# See docker/README.md ("Data directory & permissions").
# =============================================================================

# Ensure a superuser exists (create-or-update, generating one when none was
# supplied). Shared with the monolith (docker/start.sh) and sourced rather than
# executed, so both images resolve credentials the same way. A failure inside is
# logged but not fatal: PocketBase should still come up so the issue can be
# diagnosed, and the worker retries auth with backoff.
#
# Its root-only chown/chmod branches are no-ops here - this image already runs
# as uid 1001, per the ownership model above - which is exactly what is wanted.
#
# A generated credential lives only in this container. The worker container gets
# its credentials from the compose environment, so a compose stack must set both
# POCKETBASE_ADMIN_EMAIL and POCKETBASE_ADMIN_PASSWORD on the host; see
# docker/README.md.
# shellcheck source=./pb-superuser.sh
. /app/docker/pb-superuser.sh

# Replace the shell with PocketBase so signals (SIGTERM) propagate correctly.
exec "$PB_BIN" serve \
    --http="$PB_HTTP" \
    --dir="$PB_DATA_DIR" \
    --migrationsDir="$PB_MIGRATIONS_DIR" \
    --hooksDir="$PB_HOOKS_DIR"
