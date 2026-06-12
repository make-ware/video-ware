/**
 * Parse Redis URL into connection parameters
 * Supports formats:
 * - redis://:password@host:port
 * - rediss://:password@host:port (TLS)
 * - redis://host:port
 * - redis://:password@host:port/db
 */
function parseRedisUrl(url?: string): {
  host: string;
  port: number;
  password?: string;
} {
  if (!url) {
    return {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD,
    };
  }

  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: parsed.port ? parseInt(parsed.port, 10) : 6379,
      password: parsed.password || undefined,
    };
  } catch {
    // If URL parsing fails, fall back to individual env vars
    return {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD,
    };
  }
}

/**
 * Resolve a BullMQ worker concurrency value, falling back to a per-queue env
 * var, then the global WORKER_CONCURRENCY, then the provided default.
 */
function parseConcurrency(
  queueEnvVar: string | undefined,
  fallback: number
): number {
  const raw = queueEnvVar ?? process.env.WORKER_CONCURRENCY;
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export default () => {
  const redisConfig = parseRedisUrl(process.env.REDIS_URL);

  return {
    port: parseInt(process.env.PORT || '3001', 10),
    bullBoardPort: parseInt(process.env.BULL_BOARD_PORT || '3002', 10),

    redis: redisConfig,

    // Per-queue BullMQ worker concurrency.
    // Default every queue to single-threaded (1 job at a time). This is the
    // safe default for CPU-bound ffmpeg work and, more importantly, keeps us
    // under external API rate limits (e.g. Google Video Intelligence
    // "Requests per minute" quota). Bump per-queue via WORKER_CONCURRENCY_* if
    // a deployment has headroom.
    concurrency: {
      transcode: parseConcurrency(process.env.WORKER_CONCURRENCY_TRANSCODE, 1),
      render: parseConcurrency(process.env.WORKER_CONCURRENCY_RENDER, 1),
      labels: parseConcurrency(process.env.WORKER_CONCURRENCY_LABELS, 1),
      intelligence: parseConcurrency(
        process.env.WORKER_CONCURRENCY_INTELLIGENCE,
        1
      ),
    },

    pocketbase: {
      url: process.env.POCKETBASE_URL,
      adminEmail: process.env.POCKETBASE_ADMIN_EMAIL,
      adminPassword: process.env.POCKETBASE_ADMIN_PASSWORD,
      // Startup auth retry: PocketBase may not be reachable yet (or the
      // superuser may not be seeded yet) when the worker boots, especially on
      // a fresh k8s deploy. Retry with exponential backoff instead of
      // crash-looping the pod.
      connectMaxRetries: 30,
      connectRetryDelayMs: 2000,
      connectRetryMaxDelayMs: 15000,
    },

    storage: {
      type: process.env.STORAGE_TYPE || 'local',
      localPath: process.env.WORKER_DATA_DIR,
      s3Bucket: process.env.STORAGE_S3_BUCKET,
      s3Region: process.env.STORAGE_S3_REGION,
      s3Endpoint: process.env.STORAGE_S3_ENDPOINT,
      s3AccessKeyId: process.env.STORAGE_S3_ACCESS_KEY_ID,
      s3SecretAccessKey: process.env.STORAGE_S3_SECRET_ACCESS_KEY,
      s3ForcePathStyle: process.env.STORAGE_S3_FORCE_PATH_STYLE === 'true',
    },

    processors: {
      enableFfmpeg: process.env.ENABLE_FFMPEG !== 'false',
      enableGoogleTranscoder: process.env.ENABLE_GOOGLE_TRANSCODER === 'true',
      enableGoogleVideoIntelligence:
        process.env.ENABLE_GOOGLE_VIDEO_INTELLIGENCE === 'true',
      enableGoogleSpeech: process.env.ENABLE_GOOGLE_SPEECH === 'true',

      // GCVI Processor enablement
      enableLabelDetection: process.env.ENABLE_LABEL_DETECTION === 'true',
      enableObjectTracking: process.env.ENABLE_OBJECT_TRACKING === 'true',
      enableFaceDetection: process.env.ENABLE_FACE_DETECTION === 'true',
      enablePersonDetection: process.env.ENABLE_PERSON_DETECTION === 'true',
      enableSpeechTranscription:
        process.env.ENABLE_SPEECH_TRANSCRIPTION === 'true',
    },

    google: {
      projectId: process.env.GOOGLE_PROJECT_ID,
      keyFilename: process.env.GOOGLE_CLOUD_KEY_FILE || undefined,
      credentials: process.env.GOOGLE_CLOUD_CREDENTIALS
        ? JSON.parse(process.env.GOOGLE_CLOUD_CREDENTIALS)
        : undefined,
      gcsBucket: process.env.GCS_BUCKET,

      // Video Intelligence long-running operations. Every status poll is a
      // GetOperation call that counts against the API's 'Requests per minute'
      // quota, so polling is deliberately slow (exponential from initial to
      // max delay). Quota-exceeded (RESOURCE_EXHAUSTED) responses are retried
      // with their own backoff instead of failing the step.
      videoIntelligence: {
        pollInitialDelayMs: parseInt(
          process.env.GCVI_POLL_INITIAL_DELAY_MS || '20000',
          10
        ),
        pollMaxDelayMs: parseInt(
          process.env.GCVI_POLL_MAX_DELAY_MS || '90000',
          10
        ),
        // Give up waiting for an operation after this long (default 2h)
        pollTotalTimeoutMs: parseInt(
          process.env.GCVI_POLL_TOTAL_TIMEOUT_MS || '7200000',
          10
        ),
        quotaRetryInitialDelayMs: parseInt(
          process.env.GCVI_QUOTA_RETRY_INITIAL_DELAY_MS || '30000',
          10
        ),
        quotaRetryMaxDelayMs: parseInt(
          process.env.GCVI_QUOTA_RETRY_MAX_DELAY_MS || '300000',
          10
        ),
        // Give up retrying quota errors after this long (default 30m)
        quotaRetryTotalTimeoutMs: parseInt(
          process.env.GCVI_QUOTA_RETRY_TOTAL_TIMEOUT_MS || '1800000',
          10
        ),
      },
    },

    tasks: {
      enqueuerEnabled: process.env.ENABLE_TASK_ENQUEUER !== 'false',
      enqueuerPollIntervalMs: parseInt(
        process.env.TASK_ENQUEUER_POLL_INTERVAL_MS || '5000',
        10
      ),
      enqueuerBatchSize: parseInt(
        process.env.TASK_ENQUEUER_BATCH_SIZE || '25',
        10
      ),
    },
  };
};
