import { Injectable } from '@nestjs/common';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import { PocketBaseService } from '../../shared/services/pocketbase.service';

@Injectable()
export class PocketBaseIndicator extends HealthIndicator {
  constructor(private readonly pocketbaseService: PocketBaseService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      const isHealthy = await this.pocketbaseService.isHealthy();
      const result = this.getStatus(key, isHealthy, {
        connected: isHealthy,
      });

      if (isHealthy) {
        return result;
      }
      throw new HealthCheckError('PocketBase check failed', result);
    } catch (error) {
      const result = this.getStatus(key, false, {
        connected: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new HealthCheckError('PocketBase check failed', result);
    }
  }
}
