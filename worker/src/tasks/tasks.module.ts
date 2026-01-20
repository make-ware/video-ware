import { Module } from '@nestjs/common';
import { SharedModule } from '../shared/shared.module';
import { QueueModule } from '../queue/queue.module';
import { TaskEnqueuerService } from './task-enqueuer.service';

@Module({
  imports: [SharedModule, QueueModule],
  providers: [TaskEnqueuerService],
})
export class TasksModule {}
