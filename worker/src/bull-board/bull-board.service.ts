import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import express from 'express';
import { QUEUE_NAMES } from '../queue/queue.constants';

@Injectable()
export class BullBoardService implements OnModuleInit {
  private readonly logger = new Logger(BullBoardService.name);

  constructor(
    private readonly configService: ConfigService,
    @InjectQueue(QUEUE_NAMES.TRANSCODE) private readonly transcodeQueue: Queue,
    @InjectQueue(QUEUE_NAMES.INTELLIGENCE)
    private readonly intelligenceQueue: Queue,
    @InjectQueue(QUEUE_NAMES.RENDER) private readonly renderQueue: Queue,
    @InjectQueue(QUEUE_NAMES.LABELS) private readonly labelsQueue: Queue
  ) {}

  onModuleInit() {
    const port = this.configService.get<number>('bullBoardPort', 3002);
    const serverAdapter = new ExpressAdapter();
    serverAdapter.setBasePath('/');

    createBullBoard({
      queues: [
        new BullMQAdapter(this.transcodeQueue),
        new BullMQAdapter(this.intelligenceQueue),
        new BullMQAdapter(this.renderQueue),
        new BullMQAdapter(this.labelsQueue),
      ],
      serverAdapter,
    });

    const app = express();
    app.use('/', serverAdapter.getRouter());

    app.listen(port, () => {
      this.logger.log(`BullBoard is running on port ${port}`);
    });
  }
}
