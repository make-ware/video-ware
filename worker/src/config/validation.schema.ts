import * as Joi from 'joi';

export const validationSchema = Joi.object({
  // Server configuration
  PORT: Joi.string().optional(),
  BULL_BOARD_PORT: Joi.string().optional(),

  // Redis configuration
  // Allow empty string - if empty, will fall back to REDIS_HOST/REDIS_PORT/REDIS_PASSWORD
  REDIS_URL: Joi.string()
    .allow('')
    .optional()
    .custom((value, helpers) => {
      // Only validate URI format if value is provided and not empty
      if (value && value.trim().length > 0) {
        try {
          new URL(value);
        } catch {
          return helpers.message({
            custom:
              'REDIS_URL must be a valid URL (e.g., redis://:password@host:port)',
          });
        }
      }
      return value; // Allow empty string or valid URI
    }),
  REDIS_HOST: Joi.string().allow('').optional(),
  REDIS_PORT: Joi.string().allow('').optional(),
  REDIS_PASSWORD: Joi.string().allow('').optional(),

  // PocketBase configuration (required)
  POCKETBASE_URL: Joi.string().uri().required().messages({
    'string.uri': 'POCKETBASE_URL must be a valid URL',
    'any.required': 'POCKETBASE_URL is required',
  }),
  POCKETBASE_ADMIN_EMAIL: Joi.string().email().required().messages({
    'string.email': 'POCKETBASE_ADMIN_EMAIL must be a valid email',
    'any.required': 'POCKETBASE_ADMIN_EMAIL is required',
  }),
  POCKETBASE_ADMIN_PASSWORD: Joi.string().min(8).required().messages({
    'string.min': 'POCKETBASE_ADMIN_PASSWORD must be at least 8 characters',
    'any.required': 'POCKETBASE_ADMIN_PASSWORD is required',
  }),

  // Storage configuration
  STORAGE_TYPE: Joi.string().valid('local', 's3').optional(),
  WORKER_DATA_DIR: Joi.string().optional(),
  STORAGE_S3_BUCKET: Joi.string().optional(),
  STORAGE_S3_REGION: Joi.string().optional(),

  // Processor configuration
  ENABLE_FFMPEG: Joi.string().optional(),
  ENABLE_GOOGLE_TRANSCODER: Joi.string().optional(),
  ENABLE_GOOGLE_VIDEO_INTELLIGENCE: Joi.string().optional(),
  ENABLE_GOOGLE_SPEECH: Joi.string().optional(),

  // GCVI Processor configuration
  ENABLE_LABEL_DETECTION: Joi.string().optional(),
  ENABLE_OBJECT_TRACKING: Joi.string().optional(),
  ENABLE_FACE_DETECTION: Joi.string().optional(),
  ENABLE_PERSON_DETECTION: Joi.string().optional(),
  ENABLE_SPEECH_TRANSCRIPTION: Joi.string().optional(),

  // S3 Watcher configuration
  ENABLE_S3_WATCHER: Joi.string().optional(),
  S3_WATCHER_POLL_INTERVAL: Joi.string().optional(),
  S3_WATCHER_PATHS: Joi.string().optional(),

  // Google Cloud configuration
  GOOGLE_PROJECT_ID: Joi.string().optional(),
  GOOGLE_CLOUD_KEY: Joi.string().optional(),

  // Task enqueuer configuration
  ENABLE_TASK_ENQUEUER: Joi.string().optional(),
  TASK_ENQUEUER_POLL_INTERVAL_MS: Joi.string().optional(),
  TASK_ENQUEUER_BATCH_SIZE: Joi.string().optional(),
});
