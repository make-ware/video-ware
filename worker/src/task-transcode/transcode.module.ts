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
  FFmpegWaveformExecutor,
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
  WaveformStepProcessor,
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
    FFmpegWaveformExecutor,
    GoogleTranscodeExecutor,

    // Step processors
    TranscodeParentProcessor,
    ProbeStepProcessor,
    ThumbnailStepProcessor,
    SpriteStepProcessor,
    TranscodeStepProcessor,
    AudioStepProcessor,
    AutoCropStepProcessor,
    WaveformStepProcessor,
    FilmstripStepProcessor,
  ],
  exports: [TranscodeService],
})
export class TranscodeModule {}
