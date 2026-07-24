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

/** Parse a non-negative integer env var (milliseconds), else the fallback. */
function parseMs(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * Normalize an S3 key prefix: strip leading '/', ensure a trailing '/'.
 * Falls back when the result would be empty (a bare '/' would watch the
 * whole bucket).
 */
function normalizePrefix(raw: string | undefined, fallback: string): string {
  const trimmed = (raw ?? '').trim().replace(/^\/+/, '');
  if (!trimmed) return fallback;
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

export default () => {
  const redisConfig = parseRedisUrl(process.env.REDIS_URL);

  return {
    port: parseInt(process.env.PORT || '3001', 10),
    bullBoardPort: parseInt(process.env.BULL_BOARD_PORT || '3002', 10),

    redis: redisConfig,

    // Per-queue BullMQ worker concurrency.
    // CPU-bound ffmpeg queues default to single-threaded. The labels queue is
    // IO-bound — a detection step spends most of its life waiting on a Google
    // Video Intelligence operation — so it defaults to a few slots: while one
    // media's steps wait on Google, the next media can upload and enqueue.
    // That is safe because the heavy transfer is globally serialized
    // (UploadToGcsStepProcessor's transfer mutex) and every Video
    // Intelligence request is rate-gated process-wide (GoogleCloudService's
    // request gate), so labels concurrency multiplies neither bandwidth use
    // nor API request rate. Bump per-queue via WORKER_CONCURRENCY_* if a
    // deployment has headroom.
    concurrency: {
      transcode: parseConcurrency(process.env.WORKER_CONCURRENCY_TRANSCODE, 1),
      render: parseConcurrency(process.env.WORKER_CONCURRENCY_RENDER, 1),
      labels: parseConcurrency(process.env.WORKER_CONCURRENCY_LABELS, 3),
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
      enableTextDetection: process.env.ENABLE_TEXT_DETECTION === 'true',
      enableSpeechTranscription:
        process.env.ENABLE_SPEECH_TRANSCRIPTION === 'true',

      // Speaker-diarized STT via ElevenLabs (requires ELEVENLABS_API_KEY)
      enableSpeakerTranscription:
        process.env.ENABLE_SPEAKER_TRANSCRIPTION === 'true',
    },

    elevenlabs: {
      apiKey: process.env.ELEVENLABS_API_KEY,
    },

    google: {
      projectId: process.env.GOOGLE_PROJECT_ID,
      keyFilename: process.env.GOOGLE_CLOUD_KEY_FILE || undefined,
      credentials: process.env.GOOGLE_CLOUD_CREDENTIALS
        ? JSON.parse(process.env.GOOGLE_CLOUD_CREDENTIALS)
        : undefined,
      gcsBucket: process.env.GCS_BUCKET,
      // Minimum spacing between any two Video Intelligence API requests
      // process-wide (AnnotateVideo submits and GetOperation polls draw from
      // the same 'Requests per minute' quota). 5000ms caps the worker at
      // ~12 requests/min no matter how many operations are in flight. Set to
      // 0 to disable the gate.
      videoIntelligenceMinRequestIntervalMs: parseMs(
        process.env.VIDEO_INTELLIGENCE_MIN_REQUEST_INTERVAL_MS,
        5000
      ),
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

    // S3 import-folder watcher (WatchFolderService). Default OFF — it is a
    // deployment-level opt-in, and only meaningful with STORAGE_TYPE=s3.
    watchFolder: {
      enabled: process.env.ENABLE_WATCH_FOLDER === 'true',
      prefix: normalizePrefix(process.env.WATCH_FOLDER_PREFIX, 'import/'),
      quietPeriodMs: parseMs(process.env.WATCH_FOLDER_QUIET_PERIOD_MS, 900000),
      pollIntervalMs: parseMs(process.env.WATCH_FOLDER_POLL_INTERVAL_MS, 60000),
    },
  };
};
