import { Module } from '@nestjs/common';
import { RenderProcessor } from './render.processor';
import { RenderService } from './render.service';
import { SharedModule } from '../shared/shared.module';
import { QueueModule } from '../queue/queue.module';
import {
  RenderParentProcessor,
  PrepareRenderStepProcessor,
  ExecuteRenderStepProcessor,
  FinalizeRenderStepProcessor,
} from './processors';
import { FFmpegResolveClipsExecutor, FFmpegComposeExecutor } from './executors';

@Module({
  imports: [SharedModule, QueueModule],
  providers: [
    // Service
    RenderService,

    // Legacy processor (can be removed once fully migrated)
    RenderProcessor,

    // Executors (strategy implementations)
    FFmpegResolveClipsExecutor,
    FFmpegComposeExecutor,

    // Parent processor
    RenderParentProcessor,

    // Step processors
    PrepareRenderStepProcessor,
    ExecuteRenderStepProcessor,
    FinalizeRenderStepProcessor,
  ],
  exports: [RenderService],
})
export class RenderModule {}
