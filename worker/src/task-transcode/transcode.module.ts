import { Module } from '@nestjs/common';
import { TranscodeService } from './transcode.service';
import { SharedModule } from '../shared/shared.module';
import { QueueModule } from '../queue/queue.module';

// Executors
import {
  FFmpegProbeExecutor,
  FFmpegThumbnailExecutor,
  FFmpegSpriteExecutor,
  FFmpegTranscodeExecutor,
  FFmpegAudioExecutor,
  GoogleTranscodeExecutor,
} from './executors';

// Processors
import {
  FilmstripStepProcessor,
  TranscodeParentProcessor,
  ProbeStepProcessor,
  ThumbnailStepProcessor,
  SpriteStepProcessor,
  TranscodeStepProcessor,
  AudioStepProcessor,
} from './processors';

@Module({
  imports: [SharedModule, QueueModule],
  providers: [
    // Service
    TranscodeService,

    // Executors (strategy implementations)
    FFmpegProbeExecutor,
    FFmpegThumbnailExecutor,
    FFmpegSpriteExecutor,
    FFmpegTranscodeExecutor,
    FFmpegAudioExecutor,
    GoogleTranscodeExecutor,

    // Step processors
    TranscodeParentProcessor,
    ProbeStepProcessor,
    ThumbnailStepProcessor,
    SpriteStepProcessor,
    TranscodeStepProcessor,
    AudioStepProcessor,
    FilmstripStepProcessor,
  ],
  exports: [TranscodeService],
})
export class TranscodeModule {}
