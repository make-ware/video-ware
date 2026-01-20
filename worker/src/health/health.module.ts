import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { PocketBaseIndicator } from './indicators/pocketbase.indicator';
import { QueueIndicator } from './indicators/queue.indicator';
import { GoogleCloudIndicator } from './indicators/google-cloud.indicator';
import { SharedModule } from '../shared/shared.module';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [TerminusModule, SharedModule, QueueModule],
  controllers: [HealthController],
  providers: [PocketBaseIndicator, QueueIndicator, GoogleCloudIndicator],
})
export class HealthModule {}
