import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Configuration service for GCVI processor enablement.
 * Reads environment variables to determine which processors should be enabled.
 */
@Injectable()
export class ProcessorsConfigService implements OnModuleInit {
  private readonly logger = new Logger(ProcessorsConfigService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Log enabled processors on module initialization
   */
  onModuleInit() {
    const enabled = this.getEnabledProcessors();

    if (enabled.length === 0) {
      // Disabled is the default; keep startup quiet (single debug line).
      this.logger.debug(
        'No label processors enabled (ENABLE_* unset/false); label detection disabled.'
      );
      return;
    }

    this.logger.log(`Enabled label processors: ${enabled.join(', ')}`);
  }

  /**
   * Check if Label Detection processor is enabled
   * @returns true if ENABLE_LABEL_DETECTION === 'true' (default: false / disabled)
   */
  get enableLabelDetection(): boolean {
    return (
      this.configService.get<string>('ENABLE_LABEL_DETECTION', 'false') ===
      'true'
    );
  }

  /**
   * Check if Object Tracking processor is enabled
   * @returns true if enabled (default: false)
   */
  get enableObjectTracking(): boolean {
    return (
      this.configService.get<string>('ENABLE_OBJECT_TRACKING', 'false') ===
      'true'
    );
  }

  /**
   * Check if Face Detection processor is enabled
   * @returns true if enabled (default: false)
   */
  get enableFaceDetection(): boolean {
    return (
      this.configService.get<string>('ENABLE_FACE_DETECTION', 'false') ===
      'true'
    );
  }

  /**
   * Check if Person Detection processor is enabled
   * @returns true if enabled (default: false)
   */
  get enablePersonDetection(): boolean {
    return (
      this.configService.get<string>('ENABLE_PERSON_DETECTION', 'false') ===
      'true'
    );
  }

  /**
   * Check if Text Detection (on-screen text OCR) processor is enabled
   * @returns true if ENABLE_TEXT_DETECTION === 'true' (default: false / disabled)
   */
  get enableTextDetection(): boolean {
    return (
      this.configService.get<string>('ENABLE_TEXT_DETECTION', 'false') ===
      'true'
    );
  }

  /**
   * Check if Speech Transcription processor is enabled
   * @returns true if ENABLE_SPEECH_TRANSCRIPTION === 'true' (default: false / disabled)
   */
  get enableSpeechTranscription(): boolean {
    return (
      this.configService.get<string>('ENABLE_SPEECH_TRANSCRIPTION', 'false') ===
      'true'
    );
  }

  /**
   * Check if Speaker Transcription (speaker-diarized STT via ElevenLabs) is
   * enabled. Not a GCVI processor: it needs ELEVENLABS_API_KEY, not Google
   * credentials, and reads media from app storage instead of GCS.
   * @returns true if ENABLE_SPEAKER_TRANSCRIPTION === 'true' (default: false / disabled)
   */
  get enableSpeakerTranscription(): boolean {
    return (
      this.configService.get<string>(
        'ENABLE_SPEAKER_TRANSCRIPTION',
        'false'
      ) === 'true'
    );
  }

  /**
   * Get the ElevenLabs API key (required when speaker transcription is enabled)
   */
  get elevenLabsApiKey(): string | undefined {
    return this.configService.get<string>('ELEVENLABS_API_KEY');
  }

  /**
   * Get list of enabled GCVI processor names (Google-backed detections that
   * require Google credentials and the GCS temp upload).
   * @returns Array of enabled GCVI processor names
   */
  getEnabledGcviProcessors(): string[] {
    const enabled: string[] = [];

    if (this.enableLabelDetection) {
      enabled.push('LABEL_DETECTION');
    }
    if (this.enableObjectTracking) {
      enabled.push('OBJECT_TRACKING');
    }
    if (this.enableFaceDetection) {
      enabled.push('FACE_DETECTION');
    }
    if (this.enablePersonDetection) {
      enabled.push('PERSON_DETECTION');
    }
    if (this.enableTextDetection) {
      enabled.push('TEXT_DETECTION');
    }
    if (this.enableSpeechTranscription) {
      enabled.push('SPEECH_TRANSCRIPTION');
    }

    return enabled;
  }

  /**
   * Get list of all enabled label processor names (GCVI + ElevenLabs)
   * @returns Array of enabled processor names
   */
  getEnabledProcessors(): string[] {
    const enabled = this.getEnabledGcviProcessors();

    if (this.enableSpeakerTranscription) {
      enabled.push('SPEAKER_TRANSCRIPTION');
    }

    return enabled;
  }

  /**
   * Validate processor configuration
   * @throws Error if configuration is invalid
   */
  validateConfiguration(): void {
    const enabled = this.getEnabledGcviProcessors();

    // Validate that at least one processor is enabled if GCVI is enabled
    const gcviEnabled =
      this.configService.get<string>(
        'ENABLE_GOOGLE_VIDEO_INTELLIGENCE',
        'false'
      ) === 'true';

    if (gcviEnabled && enabled.length === 0) {
      throw new Error(
        'Google Video Intelligence is enabled but no GCVI processors are enabled. ' +
          'Enable at least one processor (ENABLE_LABEL_DETECTION, ENABLE_OBJECT_TRACKING, etc.)'
      );
    }

    // Speaker transcription talks to ElevenLabs, not Google; it only needs
    // its API key.
    if (this.enableSpeakerTranscription && !this.elevenLabsApiKey) {
      throw new Error(
        'ELEVENLABS_API_KEY is required when ENABLE_SPEAKER_TRANSCRIPTION is true'
      );
    }

    // Validate Google Cloud configuration if any GCVI processor is enabled
    if (enabled.length > 0) {
      const projectId = this.configService.get<string>('GOOGLE_PROJECT_ID');
      const keyFile = this.configService.get<string>('GOOGLE_CLOUD_KEY_FILE');
      const credentials = this.configService.get<string>(
        'GOOGLE_CLOUD_CREDENTIALS'
      );
      const gcsBucket = this.configService.get<string>('GCS_BUCKET');

      if (!projectId) {
        throw new Error(
          'GOOGLE_PROJECT_ID is required when GCVI processors are enabled'
        );
      }

      if (!keyFile && !credentials) {
        throw new Error(
          'Either GOOGLE_CLOUD_KEY_FILE or GOOGLE_CLOUD_CREDENTIALS is required when GCVI processors are enabled'
        );
      }

      if (!gcsBucket) {
        throw new Error(
          'GCS_BUCKET is required when GCVI processors are enabled'
        );
      }
    }

    this.logger.log('Processor configuration validated successfully');
  }

  /**
   * Check if any GCVI processor is enabled. Gates the UPLOAD_TO_GCS step,
   * which only GCVI processors consume (speaker transcription reads from app
   * storage directly).
   * @returns true if at least one GCVI processor is enabled
   */
  get hasEnabledGcviProcessors(): boolean {
    return this.getEnabledGcviProcessors().length > 0;
  }

  /**
   * Check if any label processor (GCVI or ElevenLabs) is enabled
   * @returns true if at least one processor is enabled
   */
  get hasEnabledProcessors(): boolean {
    return this.getEnabledProcessors().length > 0;
  }
}
