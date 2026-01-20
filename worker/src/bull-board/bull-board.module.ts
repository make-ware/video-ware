import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { BullBoardService } from './bull-board.service';

@Module({
  imports: [QueueModule],
  providers: [BullBoardService],
  exports: [BullBoardService],
})
export class BullBoardModule {}
