#!/bin/sh
# Graceful Shutdown Script for Docker Container
# 
# This script handles graceful shutdown of all services when the container
# receives a termination signal (SIGTERM, SIGINT).
#
# Requirements: 13.4 - Support graceful shutdown with configurable timeout periods
#
# Usage: This script is called by supervisord's eventlistener or can be
#        invoked directly for manual shutdown.

set -e

# Get shutdown timeout from environment (default: 30 seconds)
SHUTDOWN_TIMEOUT="${GRACEFUL_SHUTDOWN_TIMEOUT:-30}"

echo "=== Graceful Shutdown Initiated ==="
echo "Timeout: ${SHUTDOWN_TIMEOUT}s"
echo ""

# Function to stop a service gracefully
stop_service() {
    local service_name="$1"
    local timeout="$2"
    
    echo "Stopping $service_name..."
    
    # Use supervisorctl to stop the service
    if supervisorctl status "$service_name" 2>/dev/null | grep -q "RUNNING"; then
        supervisorctl stop "$service_name" 2>/dev/null || true
        
        # Wait for the service to stop
        local waited=0
        while [ $waited -lt $timeout ]; do
            if ! supervisorctl status "$service_name" 2>/dev/null | grep -q "RUNNING"; then
                echo "  $service_name stopped successfully"
                return 0
            fi
            sleep 1
            waited=$((waited + 1))
        done
        
        echo "  Warning: $service_name did not stop within ${timeout}s"
        return 1
    else
        echo "  $service_name is not running"
        return 0
    fi
}

# Calculate per-service timeout (divide total timeout among services)
# We have 4 services: nginx, worker, nextjs, pocketbase
# Give more time to worker and pocketbase as they may have active operations
NGINX_TIMEOUT=$((SHUTDOWN_TIMEOUT / 10))
NEXTJS_TIMEOUT=$((SHUTDOWN_TIMEOUT / 5))
WORKER_TIMEOUT=$((SHUTDOWN_TIMEOUT / 3))
POCKETBASE_TIMEOUT=$((SHUTDOWN_TIMEOUT / 3))

# Ensure minimum timeouts
[ $NGINX_TIMEOUT -lt 2 ] && NGINX_TIMEOUT=2
[ $NEXTJS_TIMEOUT -lt 5 ] && NEXTJS_TIMEOUT=5
[ $WORKER_TIMEOUT -lt 10 ] && WORKER_TIMEOUT=10
[ $POCKETBASE_TIMEOUT -lt 10 ] && POCKETBASE_TIMEOUT=10

echo "Service shutdown timeouts:"
echo "  - nginx: ${NGINX_TIMEOUT}s"
echo "  - nextjs: ${NEXTJS_TIMEOUT}s"
echo "  - worker: ${WORKER_TIMEOUT}s"
echo "  - pocketbase: ${POCKETBASE_TIMEOUT}s"
echo ""

# Stop services in reverse order of startup priority
# (nginx first, then worker, then nextjs, then pocketbase)

# 1. Stop nginx first (stops accepting new connections)
stop_service "nginx" "$NGINX_TIMEOUT"

# 2. Stop worker (allow current tasks to complete)
stop_service "worker" "$WORKER_TIMEOUT"

# 3. Stop Next.js
stop_service "nextjs" "$NEXTJS_TIMEOUT"

# 4. Stop PocketBase last (database should be last to close)
stop_service "pocketbase" "$POCKETBASE_TIMEOUT"

echo ""
echo "=== Graceful Shutdown Complete ==="

# Exit with success
exit 0
