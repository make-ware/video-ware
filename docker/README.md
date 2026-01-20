# Video Ware Deployment Guide

This guide covers deploying Video Ware in production using Docker. Video Ware can be deployed in two ways:

1. **Monolithic Container** - Single container with all services (simplest deployment)
2. **Docker Compose** - Separate containers for each service (better for scaling)

## Quick Start

### Prerequisites

- Docker 20.10+ and Docker Compose 2.0+
- Access to the container registry where images are published
- Required environment variables (see Configuration section)

## Deployment Options

### Option 1: Monolithic Container

The monolithic container includes all services (PocketBase, Next.js webapp, Worker, and Nginx) in a single image. This is the simplest deployment option.

#### Pull and Run

```bash
# Pull the latest image
docker pull ghcr.io/dastron/video-ware:latest

# Run the container
docker run -d \
  --name video-ware \
  -p 8888:80 \
  -e POCKETBASE_ADMIN_EMAIL=admin@example.com \
  -e POCKETBASE_ADMIN_PASSWORD=your-secure-password \
  -v video-ware-pb-data:/app/pb/pb_data \
  -v video-ware-worker-data:/app/data \
  ghcr.io/dastron/video-ware:latest
```

The application will be available at:
- **Web Application**: http://localhost:8888
- **PocketBase API**: http://localhost:8888/api/
- **PocketBase Admin**: http://localhost:8888/_/

#### Using a Specific Version

```bash
# Pull a specific version
docker pull ghcr.io/dastron/video-ware:1.0.0

# Run with version tag
docker run -d \
  --name video-ware \
  -p 8888:80 \
  -e POCKETBASE_ADMIN_EMAIL=admin@example.com \
  -e POCKETBASE_ADMIN_PASSWORD=your-secure-password \
  -v video-ware-pb-data:/app/pb/pb_data \
  -v video-ware-worker-data:/app/data \
  ghcr.io/dastron/video-ware:1.0.0
```

### Option 2: Docker Compose (Microservices)

Docker Compose deploys each service in its own container, allowing for better scaling and resource management.

#### Setup

1. **Create an `.env` file** in the `docker/` directory:

```bash
cd docker
cat > .env <<EOF
# PocketBase Configuration
POCKETBASE_ADMIN_EMAIL=admin@example.com
POCKETBASE_ADMIN_PASSWORD=your-secure-password

# Application URLs
NEXT_PUBLIC_POCKETBASE_URL=http://localhost:8090

# Worker Configuration (optional)
BULL_BOARD_PORT=3002
STORAGE_TYPE=local
ENABLE_FFMPEG=true

# Google Cloud Configuration (optional, for cloud features)
# GOOGLE_PROJECT_ID=your-project-id
# GOOGLE_CLOUD_CREDENTIALS={"type":"service_account","project_id":"your-project-id",...} # Inline JSON
# GCS_BUCKET=your-bucket-name

# Logging
LOG_LEVEL=warn
EOF
```

2. **Pull the images**:

```bash
docker compose pull
```

3. **Start all services**:

```bash
docker compose up -d
```

The services will be available at:
- **Web Application**: http://localhost:3000
- **PocketBase API**: http://localhost:8090/api/
- **PocketBase Admin**: http://localhost:8090/_/
- **Bull Board (Queue Dashboard)**: http://localhost:3002

4. **View logs**:

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f webapp
docker compose logs -f worker
docker compose logs -f pocketbase
```

5. **Stop services**:

```bash
docker compose down
```

## Image Registry

Video Ware images are published to GitHub Container Registry (ghcr.io) when releases are created. Images are automatically built for multiple platforms:

- `linux/amd64` - Standard x86_64 servers
- `linux/arm64` - Apple Silicon, AWS Graviton

### Image Names

The following images are available:

- `ghcr.io/dastron/video-ware:latest` - Monolithic container (all services)
- `ghcr.io/dastron/video-ware-pocketbase:latest` - PocketBase service only
- `ghcr.io/dastron/video-ware-webapp:latest` - Next.js webapp only
- `ghcr.io/dastron/video-ware-worker:latest` - Worker service only

### Image Tags

Each release produces multiple tags for version pinning:

- `latest` - Latest stable release
- `1.0.0` - Specific version
- `1.0` - Major.minor version
- `1` - Major version only
- `sha-abc1234` - Git commit SHA (for testing)

## Configuration

### Required Environment Variables

#### Monolithic Container

| Variable | Default | Description |
|----------|---------|-------------|
| `POCKETBASE_ADMIN_EMAIL` | `admin@example.com` | Admin email for PocketBase superuser |
| `POCKETBASE_ADMIN_PASSWORD` | `your-secure-password` | Admin password (must be changed for auto-setup) |

#### Docker Compose

| Variable | Description |
|----------|-------------|
| `POCKETBASE_ADMIN_EMAIL` | Admin email for PocketBase superuser |
| `POCKETBASE_ADMIN_PASSWORD` | Admin password (must be set) |

### Optional Environment Variables

#### PocketBase Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `warn` | Log level (`debug`, `info`, `warn`, `error`) |
| `POCKETBASE_URL` | `http://localhost:8090` | PocketBase server URL (Docker Compose only) |

#### Worker Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_URL` | `redis://redis:6379` | Redis connection URL (Docker Compose only) |
| `WORKER_DATA_DIR` | `/app/data` | Directory for temporary processing files |
| `WORKER_MAX_RETRIES` | `3` | Maximum retry attempts for failed tasks |
| `WORKER_PROVIDER` | `ffmpeg` | Media processing provider (`ffmpeg` or `google`) |
| `BULL_BOARD_PORT` | `3002` | Bull Board dashboard port |
| `STORAGE_TYPE` | `local` | Storage backend (`local` or `s3`) |
| `STORAGE_LOCAL_PATH` | `/app/pb/pb_data` | Local storage path |
| `ENABLE_FFMPEG` | `true` | Enable FFmpeg processing |

#### Google Cloud Configuration (Optional)

| Variable | Description |
|----------|-------------|
| `GOOGLE_PROJECT_ID` | Google Cloud project ID |
| `GOOGLE_CLOUD_CREDENTIALS` | Path to service account credentials JSON |
| `GCS_BUCKET` | Google Cloud Storage bucket name |

#### S3 Storage Configuration (Optional)

| Variable | Description |
|----------|-------------|
| `S3_ENDPOINT` | S3-compatible storage endpoint URL |
| `S3_ACCESS_KEY` | S3 access key ID |
| `S3_SECRET_KEY` | S3 secret access key |
| `S3_BUCKET` | S3 bucket name |
| `S3_REGION` | S3 region (default: `us-east-1`) |

#### Application URLs

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_POCKETBASE_URL` | `http://localhost:8090` | Public URL for PocketBase (used by browser) |

### Example: Monolithic Container with Full Configuration

```bash
docker run -d \
  --name video-ware \
  -p 8888:80 \
  -e POCKETBASE_ADMIN_EMAIL=admin@example.com \
  -e POCKETBASE_ADMIN_PASSWORD=secure-password-123 \
  -e LOG_LEVEL=warn \
  -e WORKER_PROVIDER=ffmpeg \
  -e WORKER_MAX_RETRIES=5 \
  -e GRACEFUL_SHUTDOWN_TIMEOUT=60 \
  -v video-ware-pb-data:/app/pb/pb_data \
  -v video-ware-worker-data:/app/data \
  ghcr.io/dastron/video-ware:latest
```

## Persistent Data

Both deployment options use Docker volumes to persist data across container restarts.

### Monolithic Container

- `video-ware-pb-data` - PocketBase database and files
- `video-ware-worker-data` - Worker temporary processing files

### Docker Compose

- `pb_data` - PocketBase database and files
- `redis_data` - Redis queue data

Volumes are automatically created when you start the containers. To remove all data:

```bash
# Monolithic
docker rm -v video-ware
docker volume rm video-ware-pb-data video-ware-worker-data

# Docker Compose
docker compose down -v
```

## Updating

### Monolithic Container

```bash
# Pull latest image
docker pull ghcr.io/dastron/video-ware:latest

# Stop and remove old container
docker stop video-ware
docker rm video-ware

# Start new container (volumes persist data)
docker run -d \
  --name video-ware \
  -p 8888:80 \
  -e POCKETBASE_ADMIN_EMAIL=admin@example.com \
  -e POCKETBASE_ADMIN_PASSWORD=your-secure-password \
  -v video-ware-pb-data:/app/pb/pb_data \
  -v video-ware-worker-data:/app/data \
  ghcr.io/dastron/video-ware:latest
```

### Docker Compose

## Health Checks

Both deployment options include health checks:

### Monolithic Container

The container exposes a health check endpoint at `/health`. You can verify it's running:

```bash
curl http://localhost:8888/health
```

### Docker Compose

Each service has its own health check:
- PocketBase: `/api/health`
- Redis: `redis-cli ping`
- Worker: Built into NestJS
- Webapp: Built into Next.js

View health status:

```bash
docker compose ps
```

## Troubleshooting

### Logs

#### Monolithic Container

```bash
# View all logs
docker logs -f video-ware

# View last 100 lines
docker logs --tail 100 video-ware
```

#### Docker Compose

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f webapp
docker compose logs -f worker
docker compose logs -f pocketbase
docker compose logs -f redis
```

### Common Issues

#### Container won't start

1. Check logs: `docker logs video-ware` or `docker compose logs`
2. Verify environment variables are set correctly
3. Ensure ports are not already in use
4. Check disk space: `docker system df`

#### Can't access the application

1. Verify the container is running: `docker ps`
2. Check port mappings: `docker port video-ware` or `docker compose ps`
3. Check firewall settings
4. Verify health endpoint: `curl http://localhost:8888/health`

#### PocketBase admin not working

1. Ensure `POCKETBASE_ADMIN_PASSWORD` is set to a non-default value
2. Check PocketBase logs: `docker compose logs pocketbase`
3. Access admin UI directly: http://localhost:8090/_/ or http://localhost:8888/_/

#### Worker not processing tasks

1. Check Redis connection: `docker compose logs redis`
2. Verify worker logs: `docker compose logs worker`
3. Check Bull Board dashboard: http://localhost:3002
4. Ensure Redis is healthy: `docker compose ps redis`

### Getting Help

- Check the logs for error messages
- Review the [Development Guide](../docs/DEVELOPMENT.md) for more details
- Open an issue on GitHub with logs and configuration details

## Production Recommendations

### Security

- **Change default passwords**: Always set `POCKETBASE_ADMIN_PASSWORD` to a strong, unique password
- **Use secrets management**: Store sensitive environment variables in Docker secrets or a secrets manager
- **Network isolation**: Use Docker networks to isolate services
- **Regular updates**: Keep images up to date with security patches
- **Resource limits**: Set CPU and memory limits to prevent resource exhaustion

### Resource Limits

```bash
# Monolithic container with limits
docker run -d \
  --name video-ware \
  --memory="4g" \
  --cpus="2.0" \
  -p 8888:80 \
  # ... other options

# Docker Compose with limits (add to docker-compose.yml)
services:
  webapp:
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 2G
        reservations:
          cpus: '0.5'
          memory: 1G
```

### Monitoring

- **Container metrics**: Monitor CPU, memory, and network usage
- **Log aggregation**: Forward logs to a centralized logging system
- **Health checks**: Use health check endpoints for monitoring
- **Backup**: Regularly backup PocketBase data volumes

### Backup

Backup the PocketBase data volume:

```bash
# Monolithic
docker run --rm \
  -v video-ware-pb-data:/data \
  -v $(pwd)/backups:/backup \
  alpine tar czf /backup/pb-data-$(date +%Y%m%d).tar.gz -C /data .

# Docker Compose
docker run --rm \
  -v video-ware_pb_data:/data \
  -v $(pwd)/backups:/backup \
  alpine tar czf /backup/pb-data-$(date +%Y%m%d).tar.gz -C /data .
```

## Architecture Details

### Monolithic Container

The monolithic container uses:
- **Supervisor**: Manages all processes
- **Nginx**: Reverse proxy (port 80)
- **PocketBase**: Backend API (internal port 8090)
- **Next.js**: Frontend application (internal port 3000)
- **Worker**: Background task processor

All services run in a single container, making it ideal for simple deployments.

### Docker Compose

Separate containers for:
- **Redis**: Task queue backend
- **PocketBase**: Backend API and database
- **Worker**: Background task processor
- **Webapp**: Next.js frontend

This architecture allows for independent scaling and better resource management.
