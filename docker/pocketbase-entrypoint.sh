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

POCKETBASE_ADMIN_EMAIL="${POCKETBASE_ADMIN_EMAIL:-admin@example.com}"
POCKETBASE_ADMIN_PASSWORD="${POCKETBASE_ADMIN_PASSWORD:-your-secure-password}"

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

# Create or update the superuser. `superuser upsert` writes directly to the
# database file and works whether or not `serve` is running. A failure here is
# logged but NOT fatal: PocketBase should still come up so the issue can be
# diagnosed, and the worker retries auth with backoff.
if [ -n "$POCKETBASE_ADMIN_EMAIL" ] && [ -n "$POCKETBASE_ADMIN_PASSWORD" ]; then
    if [ "$POCKETBASE_ADMIN_PASSWORD" = "your-secure-password" ]; then
        echo "⚠️  POCKETBASE_ADMIN_PASSWORD is the insecure default — set a strong password (e.g. via a k8s Secret) for production." >&2
    fi
    echo "Ensuring PocketBase superuser exists: $POCKETBASE_ADMIN_EMAIL"
    if "$PB_BIN" superuser upsert "$POCKETBASE_ADMIN_EMAIL" "$POCKETBASE_ADMIN_PASSWORD" --dir="$PB_DATA_DIR"; then
        echo "✅ PocketBase superuser ready"
    else
        echo "⚠️  superuser upsert failed — the worker may not be able to authenticate until this is resolved." >&2
    fi
else
    echo "⚠️  POCKETBASE_ADMIN_EMAIL/POCKETBASE_ADMIN_PASSWORD not set — skipping superuser upsert. The worker will not be able to authenticate." >&2
fi

# Replace the shell with PocketBase so signals (SIGTERM) propagate correctly.
exec "$PB_BIN" serve \
    --http="$PB_HTTP" \
    --dir="$PB_DATA_DIR" \
    --migrationsDir="$PB_MIGRATIONS_DIR" \
    --hooksDir="$PB_HOOKS_DIR"
