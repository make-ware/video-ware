#!/bin/sh
set -e

# Only show startup messages if LOG_LEVEL is debug or verbose
if [ "${LOG_LEVEL}" = "debug" ] || [ "${LOG_LEVEL}" = "verbose" ]; then
  echo "=== Container Startup ==="
  echo ""
  echo "Setting environment variable defaults..."
fi

# PocketBase Configuration (Requirements 4.1)
export PB_DATA_DIR="${PB_DATA_DIR:-/app/pb/pb_data}"
export PB_PUBLIC_DIR="${PB_PUBLIC_DIR:-/app/webapp/.next}"
# POCKETBASE_URL is for server-side code and worker (bypasses nginx, connects directly)
export POCKETBASE_URL="${POCKETBASE_URL:-http://localhost:8090}"
export POCKETBASE_ADMIN_EMAIL="${POCKETBASE_ADMIN_EMAIL:-admin@example.com}"
export POCKETBASE_ADMIN_PASSWORD="${POCKETBASE_ADMIN_PASSWORD:-your-secure-password}"

# Worker Configuration (Requirements 4.2)
export WORKER_DATA_DIR="${WORKER_DATA_DIR:-/app/data}"
# Set STORAGE_LOCAL_PATH to match WORKER_DATA_DIR to ensure all services use the same directory
export STORAGE_LOCAL_PATH="${STORAGE_LOCAL_PATH:-${WORKER_DATA_DIR}}"
export WORKER_MAX_RETRIES="${WORKER_MAX_RETRIES:-3}"
export WORKER_PROVIDER="${WORKER_PROVIDER:-ffmpeg}"
export WORKER_POLL_INTERVAL="${WORKER_POLL_INTERVAL:-5000}"

# Redis Configuration for NestJS worker
# REDIS_URL can be set to a full Redis URL (e.g., redis://:password@host:port)
# If not set, falls back to individual REDIS_HOST, REDIS_PORT, REDIS_PASSWORD
export REDIS_URL="${REDIS_URL:-}"
export REDIS_HOST="${REDIS_HOST:-localhost}"
export REDIS_PORT="${REDIS_PORT:-6379}"
export REDIS_PASSWORD="${REDIS_PASSWORD:-}"

# Container Behavior
export GRACEFUL_SHUTDOWN_TIMEOUT="${GRACEFUL_SHUTDOWN_TIMEOUT:-30}"

# Logging - Default to warn for production (only warnings and errors)
export LOG_LEVEL="${LOG_LEVEL:-warn}"
export NODE_ENV="${NODE_ENV:-production}"

# =============================================================================
# Step 2: Validate environment using shared schema (Requirements 4.5)
# This provides clear error messages for invalid configuration
# =============================================================================

# =============================================================================
# Step 3: Create required directories with proper permissions
# (Requirements 2.3: Create directories if they don't exist)
# =============================================================================
if [ "${LOG_LEVEL}" = "debug" ] || [ "${LOG_LEVEL}" = "verbose" ]; then
  echo "Creating required directories..."
fi

# Create PocketBase data directory
if [ ! -d "$PB_DATA_DIR" ]; then
    [ "${LOG_LEVEL}" = "debug" ] || [ "${LOG_LEVEL}" = "verbose" ] && echo "  Creating PB_DATA_DIR: $PB_DATA_DIR"
    mkdir -p "$PB_DATA_DIR"
fi

# Create worker data directory
if [ ! -d "$WORKER_DATA_DIR" ]; then
    [ "${LOG_LEVEL}" = "debug" ] || [ "${LOG_LEVEL}" = "verbose" ] && echo "  Creating WORKER_DATA_DIR: $WORKER_DATA_DIR"
    mkdir -p "$WORKER_DATA_DIR"
fi

# Create log directories
mkdir -p /var/log/supervisor
mkdir -p /var/log/nginx

# Ensure proper ownership for non-root user (nextjs:nodejs)
# Use -R for recursive ownership change
if [ "${LOG_LEVEL}" = "debug" ] || [ "${LOG_LEVEL}" = "verbose" ]; then
  echo "  Setting directory permissions..."
fi
chown -R nextjs:nodejs "$PB_DATA_DIR" 2>/dev/null || {
  if [ "${LOG_LEVEL}" = "debug" ] || [ "${LOG_LEVEL}" = "verbose" ]; then
    echo "    Warning: Could not change ownership of $PB_DATA_DIR"
  fi
}
chown -R nextjs:nodejs "$WORKER_DATA_DIR" 2>/dev/null || {
  if [ "${LOG_LEVEL}" = "debug" ] || [ "${LOG_LEVEL}" = "verbose" ]; then
    echo "    Warning: Could not change ownership of $WORKER_DATA_DIR"
  fi
}

# Set appropriate permissions (rwx for owner, rx for group)
chmod -R 755 "$PB_DATA_DIR" 2>/dev/null || true
chmod -R 755 "$WORKER_DATA_DIR" 2>/dev/null || true

if [ "${LOG_LEVEL}" = "debug" ] || [ "${LOG_LEVEL}" = "verbose" ]; then
  echo ""
  echo "Directory setup complete:"
  echo "  - PB_DATA_DIR: $PB_DATA_DIR"
  echo "  - PB_PUBLIC_DIR: $PB_PUBLIC_DIR"
  echo "  - WORKER_DATA_DIR: $WORKER_DATA_DIR"
  echo "  - STORAGE_LOCAL_PATH: $STORAGE_LOCAL_PATH"
fi

# =============================================================================
# Step 4: Verify FFmpeg installation (for worker)
# =============================================================================
if [ "${LOG_LEVEL}" = "debug" ] || [ "${LOG_LEVEL}" = "verbose" ]; then
  echo ""
  echo "Verifying FFmpeg installation..."
fi

if command -v ffmpeg >/dev/null 2>&1 && command -v ffprobe >/dev/null 2>&1; then
    if [ "${LOG_LEVEL}" = "debug" ] || [ "${LOG_LEVEL}" = "verbose" ]; then
      FFMPEG_VERSION=$(ffmpeg -version 2>/dev/null | head -n1 | awk '{print $3}' || echo "unknown")
      FFPROBE_VERSION=$(ffprobe -version 2>/dev/null | head -n1 | awk '{print $3}' || echo "unknown")
      echo "  ✅ FFmpeg found: $FFMPEG_VERSION"
      echo "  ✅ FFprobe found: $FFPROBE_VERSION"
    fi
else
    # Always show warnings about missing FFmpeg
    echo "⚠️  Warning: FFmpeg or FFprobe not found in PATH - Worker media processing may fail" >&2
fi

# =============================================================================
# Step 5: Create PocketBase superuser (Requirements 4.1)
# =============================================================================
if [ "${LOG_LEVEL}" = "debug" ] || [ "${LOG_LEVEL}" = "verbose" ]; then
  echo ""
  echo "Creating PocketBase superuser..."
fi

# Only create superuser if password is not the default insecure one
if [ "$POCKETBASE_ADMIN_PASSWORD" != "your-secure-password!" ]; then
    [ "${LOG_LEVEL}" = "debug" ] || [ "${LOG_LEVEL}" = "verbose" ] && echo "  Email: $POCKETBASE_ADMIN_EMAIL"
    [ "${LOG_LEVEL}" = "debug" ] || [ "${LOG_LEVEL}" = "verbose" ] && echo "  Creating superuser account..."
    
    # Run superuser upsert command
    # This works even if PocketBase isn't running - it modifies the database directly
    if /app/pb/pocketbase superuser upsert "$POCKETBASE_ADMIN_EMAIL" "$POCKETBASE_ADMIN_PASSWORD" --dir="$PB_DATA_DIR" 2>/dev/null; then
        [ "${LOG_LEVEL}" = "debug" ] || [ "${LOG_LEVEL}" = "verbose" ] && echo "  ✅ Superuser created successfully"
    else
        [ "${LOG_LEVEL}" = "debug" ] || [ "${LOG_LEVEL}" = "verbose" ] && echo "  ⚠️  Could not create superuser (this is normal if it already exists)"
        [ "${LOG_LEVEL}" = "debug" ] || [ "${LOG_LEVEL}" = "verbose" ] && echo "  ℹ️  Superuser will be created on first PocketBase startup if needed"
    fi
else
    echo "⚠️  Warning: Using default admin password - superuser creation skipped. Set POCKETBASE_ADMIN_PASSWORD to auto-create superuser." >&2
fi

# =============================================================================
# Step 6: Setup signal handlers for graceful shutdown (Requirements 13.4)
# =============================================================================
# Note: Signal handling is done by supervisord, but we set up the timeout
export GRACEFUL_SHUTDOWN_TIMEOUT="${GRACEFUL_SHUTDOWN_TIMEOUT:-30}"
[ "${LOG_LEVEL}" = "debug" ] || [ "${LOG_LEVEL}" = "verbose" ] && echo "" && echo "Graceful shutdown timeout: ${GRACEFUL_SHUTDOWN_TIMEOUT}s"

# =============================================================================
# Step 7: Start supervisord
# =============================================================================
if [ "${LOG_LEVEL}" = "debug" ] || [ "${LOG_LEVEL}" = "verbose" ]; then
  echo ""
  echo "Starting services with Supervisor..."
  echo "============================================"
  echo ""
fi

# Use exec to replace the shell process with supervisord
# This ensures signals are properly forwarded to supervisord
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
