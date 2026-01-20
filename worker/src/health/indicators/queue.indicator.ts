import { Injectable } from '@nestjs/common';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import { QueueService } from '../../queue/queue.service';

@Injectable()
export class QueueIndicator extends HealthIndicator {
  constructor(private readonly queueService: QueueService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      const metrics = await this.queueService.getQueueMetrics();

      // Consider queues healthy if we can get metrics
      const isHealthy = metrics && typeof metrics === 'object';

      const result = this.getStatus(key, isHealthy, {
        metrics,
        connected: isHealthy,
      });

      if (isHealthy) {
        return result;
      }
      throw new HealthCheckError('Queue check failed', result);
    } catch (error) {
      const result = this.getStatus(key, false, {
        connected: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new HealthCheckError('Queue check failed', result);
    }
  }
}
