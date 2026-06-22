import { Module } from '@nestjs/common';
import { SharedModule } from '../shared/shared.module';
import { QueueModule } from '../queue/queue.module';
import { TaskEnqueuerService } from './task-enqueuer.service';
import { IngestOrchestratorService } from './ingest-orchestrator.service';
import { CleanupOrchestratorService } from './cleanup-orchestrator.service';

@Module({
  imports: [SharedModule, QueueModule],
  providers: [
    TaskEnqueuerService,
    IngestOrchestratorService,
    CleanupOrchestratorService,
  ],
})
export class TasksModule {}
