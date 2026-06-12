import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Storage } from '@google-cloud/storage';

// Google Cloud Video Intelligence
import {
  VideoIntelligenceServiceClient,
  protos,
} from '@google-cloud/video-intelligence';

// Google Cloud Speech-to-Text
import { SpeechClient } from '@google-cloud/speech';

// Google Cloud Transcoder
import { TranscoderServiceClient } from '@google-cloud/video-transcoder';

export interface TranscoderJobResult {
  jobId: string;
  state: string;
  outputUri: string;
  progress?: number;
  error?: string;
}

type AnnotateVideoRequest =
  protos.google.cloud.videointelligence.v1.IAnnotateVideoRequest;
type AnnotateVideoResponse =
  protos.google.cloud.videointelligence.v1.IAnnotateVideoResponse;

interface VideoIntelligencePollingSettings {
  pollInitialDelayMs: number;
  pollMaxDelayMs: number;
  pollTotalTimeoutMs: number;
  quotaRetryInitialDelayMs: number;
  quotaRetryMaxDelayMs: number;
  quotaRetryTotalTimeoutMs: number;
}

/** gRPC status code for RESOURCE_EXHAUSTED (quota exceeded) */
const GRPC_RESOURCE_EXHAUSTED = 8;

@Injectable()
export class GoogleCloudService implements OnModuleInit {
  private readonly logger = new Logger(GoogleCloudService.name);

  private videoIntelligenceClient!: VideoIntelligenceServiceClient;
  private speechClient!: SpeechClient;
  private transcoderClient!: TranscoderServiceClient;
  private storageClient!: Storage;

  private readonly projectId: string;
  private readonly keyFilename?: string;
  private readonly credentials?: Record<string, unknown>;
  private readonly gcsBucket?: string;
  private readonly polling: VideoIntelligencePollingSettings;
  private readonly enabled: {
    videoIntelligence: boolean;
    speech: boolean;
    transcoder: boolean;
  };

  constructor(private readonly configService: ConfigService) {
    this.projectId = this.configService.get<string>(
      'google.projectId'
    ) as string;
    this.keyFilename = this.configService.get<string>('google.keyFilename');
    this.credentials =
      this.configService.get<Record<string, unknown>>('google.credentials');
    this.gcsBucket = this.configService.get<string>('google.gcsBucket');

    this.polling = {
      pollInitialDelayMs: this.configService.get<number>(
        'google.videoIntelligence.pollInitialDelayMs',
        20000
      ),
      pollMaxDelayMs: this.configService.get<number>(
        'google.videoIntelligence.pollMaxDelayMs',
        90000
      ),
      pollTotalTimeoutMs: this.configService.get<number>(
        'google.videoIntelligence.pollTotalTimeoutMs',
        7200000
      ),
      quotaRetryInitialDelayMs: this.configService.get<number>(
        'google.videoIntelligence.quotaRetryInitialDelayMs',
        30000
      ),
      quotaRetryMaxDelayMs: this.configService.get<number>(
        'google.videoIntelligence.quotaRetryMaxDelayMs',
        300000
      ),
      quotaRetryTotalTimeoutMs: this.configService.get<number>(
        'google.videoIntelligence.quotaRetryTotalTimeoutMs',
        1800000
      ),
    };

    this.enabled = {
      videoIntelligence: this.configService.get<boolean>(
        'processors.enableGoogleVideoIntelligence',
        false
      ),
      speech: this.configService.get<boolean>(
        'processors.enableGoogleSpeech',
        false
      ),
      transcoder: this.configService.get<boolean>(
        'processors.enableGoogleTranscoder',
        false
      ),
    };
  }

  async onModuleInit() {
    await this.initializeClients();
  }

  private async initializeClients() {
    if (!this.projectId) {
      this.logger.warn(
        'Google Cloud Project ID not configured. Google Cloud services will be disabled.'
      );
      return;
    }

    const clientConfig: Record<string, unknown> = {
      projectId: this.projectId,
      location: this.configService.get<string>('google.location'),
    };

    // Prefer inline credentials over key file
    if (this.credentials) {
      clientConfig.credentials = this.credentials;
      this.logger.log('Using inline Google Cloud credentials');
    } else if (this.keyFilename) {
      clientConfig.keyFilename = this.keyFilename;
      this.logger.log(`Using Google Cloud key file: ${this.keyFilename}`);
    } else {
      this.logger.log('Using Application Default Credentials');
    }

    // Check if any GCVI processors that need Video Intelligence are enabled
    const hasVideoIntelligenceProcessor =
      this.enabled.videoIntelligence ||
      this.configService.get<boolean>(
        'processors.enableLabelDetection',
        false
      ) ||
      this.configService.get<boolean>(
        'processors.enableObjectTracking',
        false
      ) ||
      this.configService.get<boolean>(
        'processors.enableFaceDetection',
        false
      ) ||
      this.configService.get<boolean>(
        'processors.enablePersonDetection',
        false
      );

    // Check if Speech Transcription is enabled (needs Speech client)
    const hasSpeechProcessor =
      this.enabled.speech ||
      this.configService.get<boolean>(
        'processors.enableSpeechTranscription',
        false
      );

    try {
      // Initialize Storage client (always needed for temp uploads)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.storageClient = new Storage(clientConfig as any);
      this.logger.log('Google Cloud Storage client initialized');

      // Initialize Video Intelligence client if explicitly enabled or if any GCVI processor needs it
      if (hasVideoIntelligenceProcessor) {
        this.videoIntelligenceClient = new VideoIntelligenceServiceClient(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          clientConfig as any
        );
        this.logger.log('Google Cloud Video Intelligence client initialized');
      }

      // Initialize Speech client if explicitly enabled or if Speech Transcription is enabled
      if (hasSpeechProcessor) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.speechClient = new SpeechClient(clientConfig as any);
        this.logger.log('Google Cloud Speech-to-Text client initialized');
      }

      // Initialize Transcoder client
      if (this.enabled.transcoder) {
        this.transcoderClient = new TranscoderServiceClient(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          clientConfig as any
        );
        this.logger.log('Google Cloud Transcoder client initialized');
      }

      this.logger.log('Google Cloud services initialized successfully');
    } catch (error) {
      this.logger.error(
        `Failed to initialize Google Cloud clients: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  /**
   * Get GCS bucket name
   */
  getGcsBucketName(): string | undefined {
    return this.gcsBucket;
  }

  /**
   * Create transcoding job with support for complex configurations (EditLists, multiple inputs)
   */
  async createTranscodeJob(config: {
    inputUri?: string;
    outputUri: string;
    preset?: string;
    jobConfig?: Record<string, unknown>; // Google Cloud Transcoder JobConfig
  }): Promise<TranscoderJobResult> {
    if (!this.transcoderClient) {
      throw new Error('Transcoder client not initialized');
    }

    try {
      const { inputUri, outputUri, preset, jobConfig } = config;
      this.logger.log(`Creating transcode job for output: ${outputUri}`);

      const location = this.configService.get<string>(
        'google.location',
        'us-west1'
      );
      const parent = `projects/${this.projectId}/locations/${location}`;

      const request: Record<string, unknown> = {
        parent,
        job: {
          outputUri,
        } as Record<string, unknown>,
      };

      const jobRequest = request.job as Record<string, unknown>;

      if (jobConfig) {
        jobRequest.config = jobConfig;
      } else {
        jobRequest.inputUri = inputUri;
        jobRequest.templateId = preset || 'preset/web-hd';
      }

      const [job] = await this.transcoderClient.createJob(request);

      if (!job.name) {
        throw new Error('Job creation failed - no job name returned');
      }

      this.logger.log(`Transcode job created: ${job.name}`);

      return {
        jobId: job.name,
        state: String(job.state || 'PENDING'),
        outputUri: outputUri,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Transcode job creation failed: ${errorMessage}`);
      throw new Error(`Transcoder job creation failed: ${errorMessage}`);
    }
  }

  /**
   * Get transcoding job status
   */
  async getTranscodeJobStatus(jobId: string): Promise<TranscoderJobResult> {
    if (!this.transcoderClient) {
      throw new Error('Transcoder client not initialized');
    }

    try {
      const [job] = await this.transcoderClient.getJob({ name: jobId });

      // Extract progress if available (may not be in IJob type definition)
      const jobWithProgress = job as typeof job & { progress?: number };

      return {
        jobId: job.name || jobId,
        state: (job.state as string) || 'UNKNOWN',
        outputUri: job.config?.output?.uri || '',
        progress: jobWithProgress.progress ?? 0,
        error: job.error?.message || undefined,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to get transcode job status: ${errorMessage}`);
      throw new Error(`Failed to get job status: ${errorMessage}`);
    }
  }

  /**
   * Health check for Video Intelligence service
   */
  async isVideoIntelligenceHealthy(): Promise<boolean> {
    if (!this.videoIntelligenceClient || !this.enabled.videoIntelligence) {
      return false;
    }

    try {
      // Simple health check - just verify client can make a request
      // We don't actually process anything, just check connectivity
      await this.videoIntelligenceClient.initialize();
      return true;
    } catch (error) {
      this.logger.warn(
        `Video Intelligence health check failed: ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }

  /**
   * Health check for Speech service
   */
  async isSpeechHealthy(): Promise<boolean> {
    if (!this.speechClient || !this.enabled.speech) {
      return false;
    }

    try {
      // Simple health check - just verify client can make a request
      await this.speechClient.initialize();
      return true;
    } catch (error) {
      this.logger.warn(
        `Speech service health check failed: ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }

  /**
   * Health check for Transcoder service
   */
  async isTranscoderHealthy(): Promise<boolean> {
    if (!this.transcoderClient || !this.enabled.transcoder) {
      return false;
    }

    try {
      // Simple health check - just verify client can make a request
      await this.transcoderClient.initialize();
      return true;
    } catch (error) {
      this.logger.warn(
        `Transcoder service health check failed: ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }

  /**
   * Overall health check for all enabled Google Cloud services
   */
  async isHealthy(): Promise<boolean> {
    const checks = [];

    if (this.enabled.videoIntelligence) {
      checks.push(this.isVideoIntelligenceHealthy());
    }
    if (this.enabled.speech) {
      checks.push(this.isSpeechHealthy());
    }
    if (this.enabled.transcoder) {
      checks.push(this.isTranscoderHealthy());
    }

    if (checks.length === 0) {
      // No services enabled
      return true;
    }

    try {
      const results = await Promise.all(checks);
      return results.every((result) => result === true);
    } catch (error) {
      this.logger.error(
        `Google Cloud health check failed: ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }

  /**
   * Get enabled services
   */
  getEnabledServices(): string[] {
    const services = [];
    if (this.enabled.videoIntelligence) services.push('Video Intelligence');
    if (this.enabled.speech) services.push('Speech-to-Text');
    if (this.enabled.transcoder) services.push('Transcoder');
    return services;
  }

  /**
   * Get the authenticated Video Intelligence client
   */
  getVideoIntelligenceClient(): VideoIntelligenceServiceClient {
    if (!this.videoIntelligenceClient) {
      throw new Error('Video Intelligence client not initialized');
    }
    return this.videoIntelligenceClient;
  }

  /**
   * Get the authenticated Speech client
   */
  getSpeechClient(): SpeechClient {
    if (!this.speechClient) {
      throw new Error('Speech client not initialized');
    }
    return this.speechClient;
  }

  /**
   * Start an AnnotateVideo operation and wait for its result, staying within
   * the Video Intelligence 'Requests per minute' quota:
   *
   * - The initial AnnotateVideo call is retried with exponential backoff when
   *   the API answers RESOURCE_EXHAUSTED (quota errors are transient, not
   *   fatal — the request succeeds once the per-minute window resets).
   * - The operation is then polled manually via single GetOperation calls on
   *   a slow exponential schedule (gax's operation.promise() starts polling
   *   at ~100ms intervals, which burns the same per-minute quota the
   *   AnnotateVideo calls need).
   * - A quota error *during* polling never re-issues the annotate request;
   *   the operation keeps running server-side and we simply poll again later.
   */
  async annotateVideoAndWait(
    request: AnnotateVideoRequest
  ): Promise<AnnotateVideoResponse> {
    const client = this.getVideoIntelligenceClient();

    const operation = await this.retryOnQuotaExceeded(
      `AnnotateVideo(${request.inputUri})`,
      async () => {
        const [op] = await client.annotateVideo(request);
        return op;
      }
    );

    this.logger.log(`Video Intelligence operation started: ${operation.name}`);

    const deadline = Date.now() + this.polling.pollTotalTimeoutMs;
    let pollDelayMs = this.polling.pollInitialDelayMs;
    let quotaRetryDelayMs = this.polling.quotaRetryInitialDelayMs;

    while (!operation.done) {
      if (Date.now() >= deadline) {
        throw new Error(
          `Video Intelligence operation ${operation.name} did not complete ` +
            `within ${this.polling.pollTotalTimeoutMs}ms`
        );
      }

      await this.sleep(this.withJitter(pollDelayMs));

      try {
        // Single GetOperation call; updates operation.done/result in place
        // and rejects if the operation itself completed with an error.
        await operation.getOperation();
        pollDelayMs = Math.min(pollDelayMs * 1.5, this.polling.pollMaxDelayMs);
        quotaRetryDelayMs = this.polling.quotaRetryInitialDelayMs;
      } catch (error) {
        // getOperation() also rejects when the OPERATION completed with an
        // error (gax records it on operation.error); that is final. Only
        // transport-level quota rejections of the poll itself are retryable.
        if (operation.error || !this.isQuotaExceededError(error)) {
          throw error;
        }
        // The poll itself was rejected for quota; the operation is still
        // running server-side. Back off harder and poll again.
        this.logger.warn(
          `Quota exceeded while polling operation ${operation.name}; ` +
            `retrying in ${quotaRetryDelayMs}ms`
        );
        pollDelayMs = Math.min(quotaRetryDelayMs, this.polling.pollMaxDelayMs);
        quotaRetryDelayMs = Math.min(
          quotaRetryDelayMs * 2,
          this.polling.quotaRetryMaxDelayMs
        );
      }
    }

    if (!operation.result) {
      throw new Error(
        `Video Intelligence operation ${operation.name} completed without a result`
      );
    }

    return operation.result as AnnotateVideoResponse;
  }

  /**
   * Run an API call, retrying with exponential backoff (plus jitter) while it
   * fails with RESOURCE_EXHAUSTED. Any other error propagates immediately.
   */
  private async retryOnQuotaExceeded<T>(
    label: string,
    call: () => Promise<T>
  ): Promise<T> {
    const deadline = Date.now() + this.polling.quotaRetryTotalTimeoutMs;
    let delayMs = this.polling.quotaRetryInitialDelayMs;

    for (;;) {
      try {
        return await call();
      } catch (error) {
        if (!this.isQuotaExceededError(error) || Date.now() >= deadline) {
          throw error;
        }
        this.logger.warn(
          `Quota exceeded for ${label}; retrying in ${delayMs}ms`
        );
        await this.sleep(this.withJitter(delayMs));
        delayMs = Math.min(delayMs * 2, this.polling.quotaRetryMaxDelayMs);
      }
    }
  }

  /**
   * Detect a Video Intelligence quota error (gRPC RESOURCE_EXHAUSTED).
   */
  private isQuotaExceededError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const { code, message } = error as { code?: unknown; message?: unknown };
    if (code === GRPC_RESOURCE_EXHAUSTED) return true;
    return (
      typeof message === 'string' &&
      (message.includes('RESOURCE_EXHAUSTED') ||
        message.includes('Quota exceeded'))
    );
  }

  /** Add ±20% jitter so concurrent operations don't poll in lockstep. */
  private withJitter(delayMs: number): number {
    return Math.round(delayMs * (0.8 + Math.random() * 0.4));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get the GCS path for a temporary file (for processing)
   * Path structure: temp/{workspaceId}/{mediaId}
   */
  private getTempGcsPath(workspaceId: string, mediaId: string): string {
    return `temp/${workspaceId}/${mediaId}`;
  }

  /**
   * Get the GCS URI for a temporary file (for processing)
   * Returns: gs://{bucket}/temp/{workspaceId}/{mediaId}
   */
  getTempGcsUri(workspaceId: string, mediaId: string): string {
    if (!this.gcsBucket) {
      throw new Error('GCS_BUCKET not configured');
    }
    const gcsPath = this.getTempGcsPath(workspaceId, mediaId);
    return `gs://${this.gcsBucket}/${gcsPath}`;
  }

  /**
   * Upload a local file to GCS temporarily for processing
   * Uses deterministic path: temp/{workspaceId}/{mediaId}
   * Returns the GCS URI (gs://bucket/path)
   */
  async uploadToGcsTempBucket(
    localFilePath: string,
    workspaceId: string,
    mediaId: string
  ): Promise<string> {
    if (!this.storageClient) {
      throw new Error('Google Cloud Storage client not initialized');
    }

    if (!this.gcsBucket) {
      throw new Error(
        'GCS_BUCKET not configured. Set GCS_BUCKET environment variable.'
      );
    }

    try {
      const gcsPath = this.getTempGcsPath(workspaceId, mediaId);
      const bucket = this.storageClient.bucket(this.gcsBucket);
      const gcsUri = this.getTempGcsUri(workspaceId, mediaId);

      this.logger.log(`Uploading ${localFilePath} to ${gcsUri}`);

      await bucket.upload(localFilePath, {
        destination: gcsPath,
        metadata: {
          metadata: {
            uploadedAt: new Date().toISOString(),
            workspaceId: workspaceId,
            mediaId: mediaId,
            temporary: 'true',
          },
        },
      });

      this.logger.log(`Successfully uploaded to ${gcsUri}`);

      return gcsUri;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to upload to GCS: ${errorMessage}`);
      throw new Error(`GCS upload failed: ${errorMessage}`);
    }
  }

  /**
   * Check if a file exists in GCS
   */
  async checkGcsFileExists(gcsUri: string): Promise<boolean> {
    if (!this.storageClient) {
      throw new Error('Google Cloud Storage client not initialized');
    }

    if (!this.gcsBucket) {
      return false;
    }

    try {
      // Extract path from gs://bucket/path
      const gcsPath = gcsUri.replace(`gs://${this.gcsBucket}/`, '');
      const bucket = this.storageClient.bucket(this.gcsBucket);
      const file = bucket.file(gcsPath);

      const [exists] = await file.exists();
      return exists;
    } catch (error) {
      this.logger.debug(`Error checking GCS file existence: ${error}`);
      return false;
    }
  }

  /**
   * Delete temporary file from GCS
   */
  async deleteFromGcsTempBucket(gcsUri: string): Promise<void> {
    if (!this.storageClient) {
      throw new Error('Google Cloud Storage client not initialized');
    }

    if (!this.gcsBucket) {
      this.logger.warn('GCS_BUCKET not configured, skipping cleanup');
      return;
    }

    try {
      // Extract path from gs://bucket/path
      const gcsPath = gcsUri.replace(`gs://${this.gcsBucket}/`, '');
      const bucket = this.storageClient.bucket(this.gcsBucket);
      const file = bucket.file(gcsPath);

      this.logger.log(`Deleting temporary file: ${gcsUri}`);
      await file.delete({ ignoreNotFound: true });
      this.logger.log(`Successfully deleted ${gcsUri}`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to delete from GCS: ${errorMessage}`);
      // Don't throw - cleanup failures shouldn't break the flow
    }
  }
}
