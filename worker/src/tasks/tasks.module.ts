import { Module } from '@nestjs/common';
import { SharedModule } from '../shared/shared.module';
import { QueueModule } from '../queue/queue.module';
import { TaskEnqueuerService } from './task-enqueuer.service';
import { IngestOrchestratorService } from './ingest-orchestrator.service';
import { CleanupOrchestratorService } from './cleanup-orchestrator.service';
import { IngestBackfillService } from './ingest-backfill.service';

@Module({
  imports: [SharedModule, QueueModule],
  providers: [
    TaskEnqueuerService,
    IngestOrchestratorService,
    CleanupOrchestratorService,
    IngestBackfillService,
  ],
})
export class TasksModule {}
