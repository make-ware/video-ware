import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { PocketBaseIndicator } from './indicators/pocketbase.indicator';
import { QueueIndicator } from './indicators/queue.indicator';
import { GoogleCloudIndicator } from './indicators/google-cloud.indicator';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly pocketbaseIndicator: PocketBaseIndicator,
    private readonly queueIndicator: QueueIndicator,
    private readonly googleCloudIndicator: GoogleCloudIndicator
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.pocketbaseIndicator.isHealthy('pocketbase'),
      () => this.queueIndicator.isHealthy('queue'),
      () => this.googleCloudIndicator.isHealthy('googleCloud'),
    ]);
  }
}
