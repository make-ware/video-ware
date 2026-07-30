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
  FFmpegAutoCropExecutor,
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
  AutoCropStepProcessor,
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
    FFmpegAutoCropExecutor,
    GoogleTranscodeExecutor,

    // Step processors
    TranscodeParentProcessor,
    ProbeStepProcessor,
    ThumbnailStepProcessor,
    SpriteStepProcessor,
    TranscodeStepProcessor,
    AudioStepProcessor,
    AutoCropStepProcessor,
    FilmstripStepProcessor,
  ],
  exports: [TranscodeService],
})
export class TranscodeModule {}
