import { Injectable } from '@nestjs/common';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import { GoogleCloudService } from '../../shared/services/google-cloud.service';

@Injectable()
export class GoogleCloudIndicator extends HealthIndicator {
  constructor(private readonly googleCloudService: GoogleCloudService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      const healthChecks = await Promise.allSettled([
        this.googleCloudService.isVideoIntelligenceHealthy(),
        this.googleCloudService.isSpeechHealthy(),
        this.googleCloudService.isTranscoderHealthy(),
      ]);

      const videoIntelligenceHealthy =
        healthChecks[0].status === 'fulfilled' && healthChecks[0].value;
      const speechHealthy =
        healthChecks[1].status === 'fulfilled' && healthChecks[1].value;
      const transcoderHealthy =
        healthChecks[2].status === 'fulfilled' && healthChecks[2].value;

      // Consider Google Cloud healthy if at least one service is available
      const isHealthy =
        videoIntelligenceHealthy || speechHealthy || transcoderHealthy;

      const result = this.getStatus(key, isHealthy, {
        videoIntelligence: videoIntelligenceHealthy,
        speech: speechHealthy,
        transcoder: transcoderHealthy,
        connected: isHealthy,
      });

      if (isHealthy) {
        return result;
      }
      throw new HealthCheckError('Google Cloud check failed', result);
    } catch (error) {
      const result = this.getStatus(key, false, {
        connected: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new HealthCheckError('Google Cloud check failed', result);
    }
  }
}
