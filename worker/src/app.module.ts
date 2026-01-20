import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import configuration from './config/configuration';
import { validationSchema } from './config/validation.schema';
import { QueueModule } from './queue/queue.module';
import { SharedModule } from './shared/shared.module';
import { TranscodeModule } from './task-transcode/transcode.module';
import { RenderModule } from './task-render/render.module';
import { HealthModule } from './health/health.module';
import { TasksModule } from './tasks/tasks.module';
import { LabelsModule } from './task-labels/labels.module';
import { BullBoardModule } from './bull-board/bull-board.module';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema,
      envFilePath: '../.env',
    }),

    // BullMQ Queue
    BullModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get('redis.host'),
          port: configService.get('redis.port'),
          password: configService.get('redis.password'),
        },
        defaultJobOptions: {
          attempts: 5,
          backoff: {
            type: 'exponential',
            delay: 60000, // 60 seconds
          },
          removeOnComplete: true,
          removeOnFail: false,
        },
      }),
      inject: [ConfigService],
    }),

    // Scheduling
    ScheduleModule.forRoot(),

    // Feature modules
    SharedModule,
    QueueModule,
    TasksModule,
    TranscodeModule,
    LabelsModule,
    RenderModule,
    HealthModule,
    BullBoardModule,
  ],
})
export class AppModule {}
