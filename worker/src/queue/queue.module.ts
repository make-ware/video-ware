import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QueueService } from './queue.service';
import { FlowService } from './flow.service';
import { JobService } from './job.service';
import { ProcessorsConfigService } from '../config/processors.config';
import { QUEUE_NAMES } from './queue.constants';
import { SharedModule } from '../shared/shared.module';

@Module({
  imports: [
    // SharedModule gives JobService the PocketBaseService it uses to keep
    // LabelJobs in sync with submitted detect_labels flows.
    SharedModule,
    BullModule.registerQueue(
      { name: QUEUE_NAMES.TRANSCODE },
      { name: QUEUE_NAMES.INTELLIGENCE },
      { name: QUEUE_NAMES.RENDER },
      { name: QUEUE_NAMES.LABELS }
    ),
  ],
  // ProcessorsConfigService is stateless over env config, so providing a
  // second instance here (next to LabelsModule's) is safe; it lets JobService
  // gate flow children on the same ENABLE_* flags the processors use.
  providers: [QueueService, FlowService, JobService, ProcessorsConfigService],
  exports: [QueueService, FlowService, JobService, BullModule],
})
export class QueueModule {}
