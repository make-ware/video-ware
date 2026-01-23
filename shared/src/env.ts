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
  POCKETBASE_URL: z.string().default('http://localhost:8090'),
  POCKETBASE_ADMIN_EMAIL: z.string().email().default('admin@example.com'),
  POCKETBASE_ADMIN_PASSWORD: z.string().default('your-secure-password'),

  // ===========================================
  // Next.js Configuration
  // ===========================================
  NEXT_PUBLIC_POCKETBASE_URL: z.string().default('http://localhost:8090'),
  NEXTAUTH_SECRET: z.string().default('your-nextauth-secret-here'),
  NEXTAUTH_URL: z.string().url().default('http://localhost:3000'),

  // ===========================================
  // Redis Configuration
  // ===========================================
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // ===========================================
  // Worker Configuration
  // ===========================================
  BULL_BOARD_PORT: z.coerce.number().default(3002),
  STORAGE_TYPE: z.enum(['local', 's3']).default('local'),
  WORKER_DATA_DIR: z.string().default('/data/storage'),

  // ===========================================
  // Google Cloud Configuration
  // ===========================================
  GOOGLE_PROJECT_ID: z.string().optional(),
  GOOGLE_CLOUD_CREDENTIALS: z.string().optional(),
  GCS_BUCKET: z.string().optional(),

  // ===========================================
  // Container Deployment Configuration
  // ===========================================
  /** Directory for PocketBase data storage */
  PB_DATA_DIR: z.string().default('/data/pb_data'),
  /** Directory for PocketBase public/static files */
  PB_PUBLIC_DIR: z.string().default('/app/webapp/.next'),

  // ===========================================
  // S3 Storage Configuration (Optional)
  // ===========================================
  S3_ENDPOINT: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),

  // ===========================================
  // Monitoring & Behavior
  // ===========================================
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  GRACEFUL_SHUTDOWN_TIMEOUT: z.coerce.number().min(5).max(300).default(30),
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
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
