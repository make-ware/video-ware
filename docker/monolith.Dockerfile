# Multi-stage build for Next.js + PocketBase + Worker monorepo
FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat unzip curl
WORKDIR /app

# Install Yarn v4
RUN corepack enable && corepack prepare yarn@4.12.0 --activate

# Copy package files
COPY package.json yarn.lock .yarnrc.yml* ./
COPY webapp/package.json ./webapp/
COPY shared/package.json ./shared/
COPY pb/package.json ./pb/
COPY worker/package.json ./worker/
COPY cli/package.json ./cli/

# Install dependencies
RUN yarn install --immutable

# Download PocketBase binary
# Supports multi-architecture builds via TARGETARCH
# TARGETARCH is automatically provided by Docker Buildx
ARG POCKETBASE_VERSION=0.39.4
ARG TARGETARCH
RUN mkdir -p /app/pb && \
    # Map Docker TARGETARCH to PocketBase architecture naming
    POCKETBASE_ARCH=$(case "${TARGETARCH}" in \
        "amd64") echo "amd64" ;; \
        "arm64") echo "arm64" ;; \
        *) echo "amd64" ;; \
    esac) && \
    echo "Downloading PocketBase v${POCKETBASE_VERSION} for architecture: ${POCKETBASE_ARCH}" && \
    echo "Target architecture: ${TARGETARCH}" && \
    curl -f -L -S "https://github.com/pocketbase/pocketbase/releases/download/v${POCKETBASE_VERSION}/pocketbase_${POCKETBASE_VERSION}_linux_${POCKETBASE_ARCH}.zip" \
    -o /tmp/pocketbase.zip && \
    unzip /tmp/pocketbase.zip -d /app/pb && \
    chmod +x /app/pb/pocketbase && \
    echo "Verifying binary..." && \
    head -c 4 /app/pb/pocketbase | od -A x -t x1 | head -1 && \
    rm /tmp/pocketbase.zip && \
    echo "PocketBase downloaded successfully"

# Build stage
FROM base AS builder
WORKDIR /app

# Build argument for NEXT_PUBLIC_POCKETBASE_URL
# This is embedded into the Next.js build at build time
# - Production/Staging: "/" (routes through nginx)
# - Development: "http://localhost:8090" (direct connection)
ARG NEXT_PUBLIC_POCKETBASE_URL="/"

# Install Yarn v4
RUN corepack enable && corepack prepare yarn@4.12.0 --activate

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/.yarn ./.yarn
COPY --from=deps /app/pb/pocketbase ./pb/pocketbase

# Copy workspace files
COPY package.json yarn.lock .yarnrc.yml* ./
COPY webapp ./webapp
COPY shared ./shared
# Copy pb directory but exclude the binary (we use the downloaded one from deps stage)
COPY pb/pb_hooks ./pb/pb_hooks
COPY pb/pb_migrations ./pb/pb_migrations
COPY pb/package.json ./pb/package.json
COPY worker ./worker

# Build shared package first (required by webapp and worker)
RUN yarn workspace @project/shared build

# Build Next.js application
# Set NEXT_PUBLIC_POCKETBASE_URL as ENV so it's available during Next.js build
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_POCKETBASE_URL=${NEXT_PUBLIC_POCKETBASE_URL}
# Verify the environment variable is set correctly before building
RUN echo "Building Next.js with NEXT_PUBLIC_POCKETBASE_URL=${NEXT_PUBLIC_POCKETBASE_URL}"
RUN yarn workspace @project/webapp build

# Build worker TypeScript to JavaScript
RUN yarn workspace @project/worker build && \
    # Verify the build output exists
    test -f /app/worker/dist/main.js || (echo "ERROR: Worker build failed - dist/main.js not found" && exit 1) && \
    echo "✅ Worker build successful - dist/main.js exists"

# Ensure optional files/directories exist for runner stage
RUN mkdir -p /app/pb/pb_migrations && \
    touch /app/.yarnrc.yml 2>/dev/null || true && \
    mkdir -p /app/shared/node_modules /app/worker/node_modules 2>/dev/null || true

# Ensure pb_migrations exists (it might not exist in source)
RUN mkdir -p /app/pb/pb_migrations

# -----------------------------------------------------------------------------
# Base Runner (Common setup for all runner stages)
# -----------------------------------------------------------------------------
FROM base AS runner-base
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Install Yarn v4
RUN corepack enable && corepack prepare yarn@4.12.0 --activate

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs && \
    adduser nextjs nodejs

# Create cache directories for Node.js and Yarn with proper permissions
RUN mkdir -p /app/.cache/node /app/.yarn/cache && \
    chown -R nextjs:nodejs /app/.cache /app/.yarn/cache

# Copy package files for workspace resolution
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./
COPY --from=builder --chown=nextjs:nodejs /app/yarn.lock ./
COPY --from=builder --chown=nextjs:nodejs /app/.yarn ./.yarn
COPY --from=builder --chown=nextjs:nodejs /app/.yarnrc.yml ./.yarnrc.yml

# Copy node_modules (production deps)
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules

# -----------------------------------------------------------------------------
# Monolith Target (Original behavior)
# -----------------------------------------------------------------------------
FROM runner-base AS monolith

# Set default log level
ENV LOG_LEVEL=warn
ENV POCKETBASE_URL="http://localhost:8090"
# The monolith bundles Redis internally so it is fully self-contained (no
# external Redis container required, e.g. for Unraid single-container installs).
# Redis listens on localhost only and is never exposed outside the container.
# Override REDIS_URL to point the worker at an external Redis instead.
ENV REDIS_URL="redis://127.0.0.1:6379"

# Install supervisor, nginx, curl, ffmpeg, and redis.
# Redis is the BullMQ broker for the bundled worker; running it in-container
# keeps the monolith self-contained.
# fontconfig + a font package are required for ffmpeg's drawtext filter
# (used to burn in captions); without them drawtext fails with
# "Cannot find a valid font for the family Sans". We copy the resolved
# DejaVu files to a fixed path and pin RENDER_FONT_FILE so captions/titles
# render with a deterministic font in every environment.
RUN apk add --no-cache supervisor nginx curl ffmpeg redis fontconfig font-dejavu && \
    fc-cache -f && \
    mkdir -p /opt/fonts && \
    cp "$(fc-match -f '%{file}' 'DejaVu Sans')" /opt/fonts/regular.ttf && \
    cp "$(fc-match -f '%{file}' 'DejaVu Sans:bold')" /opt/fonts/bold.ttf && \
    rm -rf /var/cache/apk/*
ENV RENDER_FONT_FILE=/opt/fonts/regular.ttf
ENV RENDER_FONT_FILE_BOLD=/opt/fonts/bold.ttf

# Create directories for supervisor and nginx
RUN mkdir -p /var/log/supervisor /var/run /etc/supervisor/conf.d && \
    mkdir -p /var/log/nginx /var/cache/nginx /var/run/nginx && \
    chown -R nextjs:nodejs /var/log/supervisor /var/run && \
    chown -R nginx:nginx /var/log/nginx /var/cache/nginx /var/run/nginx

# Copy PocketBase binary and files
COPY --from=builder --chown=nextjs:nodejs /app/pb/pocketbase ./pb/pocketbase
COPY --from=builder --chown=nextjs:nodejs /app/pb/pb_hooks ./pb/pb_hooks
COPY --from=builder --chown=nextjs:nodejs /app/pb/pb_migrations ./pb/pb_migrations

# Create the full /data tree and make the WHOLE tree (including /data itself)
# owned by nextjs:nodejs (uid/gid 1001). Named volumes inherit this ownership;
# for bind mounts, start.sh re-asserts it at runtime (the monolith runs start.sh
# as root, so it can chown). See docker/README.md ("Data directory & permissions").
RUN mkdir -p /data/pb_data /data/storage /data/redis /data/tmp && \
    chown -R nextjs:nodejs /data

# Route ALL scratch I/O (Node's os.tmpdir() — used for worker-temp S3 download
# staging — and ffmpeg temp files) to the /data volume instead of the
# container's writable layer. Without this, large intermediate render/transcode
# files land in /tmp inside the container filesystem (e.g. Unraid's docker.img,
# or RAM when /tmp is tmpfs-mounted) and can exhaust it. /data is expected to
# be a volume/bind mount backed by real disk.
ENV TMPDIR=/data/tmp


# Copy workspace package.json files
COPY --from=builder --chown=nextjs:nodejs /app/webapp/package.json ./webapp/
COPY --from=builder --chown=nextjs:nodejs /app/shared/package.json ./shared/
COPY --from=builder --chown=nextjs:nodejs /app/pb/package.json ./pb/
COPY --from=builder --chown=nextjs:nodejs /app/worker/package.json ./worker/

# Copy built application files
COPY --from=builder --chown=nextjs:nodejs /app/webapp/.next ./webapp/.next
COPY --from=builder --chown=nextjs:nodejs /app/webapp/public ./webapp/public
COPY --from=builder --chown=nextjs:nodejs /app/webapp/next.config.ts ./webapp/next.config.ts
COPY --from=builder --chown=nextjs:nodejs /app/webapp/tsconfig.json ./webapp/tsconfig.json
COPY --from=builder --chown=nextjs:nodejs /app/shared/dist ./shared/dist
COPY --from=builder --chown=nextjs:nodejs /app/worker/dist ./worker/dist

# Copy config scripts
COPY --chown=root:root docker/supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY --chown=root:root docker/nginx.conf /etc/nginx/nginx.conf
COPY --chown=nextjs:nodejs docker/start.sh /app/start.sh
COPY --chown=root:root docker/graceful-shutdown.sh /app/docker/graceful-shutdown.sh

RUN chmod +x /app/start.sh && \
    chmod +x /app/docker/graceful-shutdown.sh && \
    chmod 644 /etc/nginx/nginx.conf

EXPOSE 80
ENV HOSTNAME="0.0.0.0"
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost/health || exit 1

CMD ["/app/start.sh"]

