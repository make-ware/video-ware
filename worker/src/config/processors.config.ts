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
    this.logger.log(`Enabled GCVI processors: ${enabled.join(', ')}`);

    if (enabled.length === 0) {
      this.logger.warn(
        'No GCVI processors are enabled. Label detection will not run.'
      );
    }
  }

  /**
   * Check if Label Detection processor is enabled
   * @returns true if enabled (default: true)
   */
  get enableLabelDetection(): boolean {
    return (
      this.configService.get<string>('ENABLE_LABEL_DETECTION', 'true') ===
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
   * Check if Speech Transcription processor is enabled
   * @returns true if enabled (default: true)
   */
  get enableSpeechTranscription(): boolean {
    return (
      this.configService.get<string>('ENABLE_SPEECH_TRANSCRIPTION', 'true') ===
      'true'
    );
  }

  /**
   * Get list of enabled processor names
   * @returns Array of enabled processor names
   */
  getEnabledProcessors(): string[] {
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
    if (this.enableSpeechTranscription) {
      enabled.push('SPEECH_TRANSCRIPTION');
    }

    return enabled;
  }

  /**
   * Validate processor configuration
   * @throws Error if configuration is invalid
   */
  validateConfiguration(): void {
    const enabled = this.getEnabledProcessors();

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

    // Validate Google Cloud configuration if any processor is enabled
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
   * Check if any GCVI processor is enabled
   * @returns true if at least one processor is enabled
   */
  get hasEnabledProcessors(): boolean {
    return this.getEnabledProcessors().length > 0;
  }
}
