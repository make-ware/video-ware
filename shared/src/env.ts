import { z } from 'zod';

/**
 * Shared environment variable schema with defaults
 *
 * This schema defines all environment variables used across the application,
 * including deployment-specific configuration for Docker containers.
 */
export const envSchema = z.object({
  // ===========================================
  // PocketBase Configuration
  // ===========================================
  /**
   * Server-side PocketBase URL
   *
   * Used by:
   * - Next.js API routes and Server Actions
   * - Worker processes
   * - Any server-side code
   *
   * Always points directly to PocketBase (http://localhost:8090) because
   * server-side code bypasses nginx and connects directly to PocketBase.
   *
   * Default: http://localhost:8090
   */
  POCKETBASE_URL: z.string().default('http://localhost:8090'),
  POCKETBASE_ADMIN_EMAIL: z.string().email().default('admin@example.com'),
  POCKETBASE_ADMIN_PASSWORD: z.string().default('your-secure-password'),

  // ===========================================
  // Next.js Configuration
  // (Prefix with NEXT_PUBLIC_ for client-side access)
  // ===========================================
  /**
   * Client-side PocketBase URL
   *
   * Used by:
   * - Client Components ('use client')
   * - Browser-side code
   * - Any code that runs in the browser
   *
   * In production/staging: "/" (routes through nginx)
   * In development: "http://localhost:8090" (direct connection)
   *
   * Client-side requests go: Browser → Nginx → PocketBase
   *
   * Default: http://localhost:8090 (for development)
   */
  NEXT_PUBLIC_POCKETBASE_URL: z.string().default('http://localhost:8090'),
  NEXTAUTH_SECRET: z.string().default('your-nextauth-secret-here'),
  NEXTAUTH_URL: z.string().url().default('http://localhost:3000'),

  // ===========================================
  // Node Environment
  // ===========================================
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),

  // ===========================================
  // Google Cloud Configuration
  // ===========================================
  GOOGLE_CLOUD_PROJECT: z.string().optional(),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),

  // ===========================================
  // Container Deployment Configuration
  // (Requirements 4.1: PocketBase configuration)
  // ===========================================
  /** Directory for PocketBase data storage */
  PB_DATA_DIR: z.string().default('/app/pb/pb_data'),
  /** Directory for PocketBase public/static files */
  PB_PUBLIC_DIR: z.string().default('/app/webapp/.next'),

  // ===========================================
  // Worker Configuration
  // (Requirements 4.2: Worker configuration)
  // ===========================================
  /** Directory for worker temporary data and processing files */
  WORKER_DATA_DIR: z.string().default('/app/data'),
  /** Number of concurrent worker processes */
  /** WORKER_CONCURRENCY: z.coerce.number().min(1).max(10).default(2), */
  /** Maximum retry attempts for failed tasks */
  WORKER_MAX_RETRIES: z.coerce.number().min(0).max(10).default(3),
  /** Media processing provider selection */
  WORKER_PROVIDER: z.enum(['ffmpeg', 'google']).default('ffmpeg'),
  /** Interval in milliseconds between task queue polls */
  WORKER_POLL_INTERVAL: z.coerce.number().min(1000).max(60000).default(5000),

  // ===========================================
  // S3 Storage Configuration (Optional)
  // (Requirements 4.3: External service configuration)
  // ===========================================
  /** S3-compatible storage endpoint URL */
  S3_ENDPOINT: z.string().optional(),
  /** S3 access key ID */
  S3_ACCESS_KEY: z.string().optional(),
  /** S3 secret access key */
  S3_SECRET_KEY: z.string().optional(),
  /** S3 bucket name */
  S3_BUCKET: z.string().optional(),
  /** S3 region */
  S3_REGION: z.string().default('us-east-1'),

  // ===========================================
  // Monitoring & Logging Configuration
  // ===========================================
  /** Application log level */
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  /** Enable Prometheus metrics endpoint */
  METRICS_ENABLED: z.coerce.boolean().default(false),
  /** Port for health check endpoint */
  HEALTH_CHECK_PORT: z.coerce.number().min(1).max(65535).default(8090),

  // ===========================================
  // Container Behavior Configuration
  // ===========================================
  /** Timeout in seconds for graceful shutdown */
  GRACEFUL_SHUTDOWN_TIMEOUT: z.coerce.number().min(5).max(300).default(30),
});

/**
 * Validates environment variables and returns parsed values.
 * Use this function when you need to validate without throwing on failure.
 */
export function validateEnv(
  env: Record<string, string | undefined> = process.env
): ReturnType<typeof envSchema.safeParse> {
  return envSchema.safeParse(env);
}

/**
 * Validates environment variables and throws with clear error messages on failure.
 * Use this for container startup validation (Requirements 4.5).
 */
export function parseEnvOrThrow(
  env: Record<string, string | undefined> = process.env
): Env {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const errors = result.error.issues
      .map((e) => `  - ${e.path.join('.')}: ${e.message}`)
      .join('\n');
    throw new Error(`Environment validation failed:\n${errors}`);
  }
  return result.data;
}

/**
 * Validated environment variables
 */
export const env = envSchema.parse(process.env);

/**
 * Type for environment variables
 */
export type Env = z.infer<typeof envSchema>;
