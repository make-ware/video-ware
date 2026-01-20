import { Module } from '@nestjs/common';
import { SharedModule } from '../shared/shared.module';
import { QueueModule } from '../queue/queue.module';
import { ProcessorsConfigService } from '../config/processors.config';
import { LabelsService } from './labels.service';
import {
  DetectLabelsParentProcessor,
  UploadToGcsStepProcessor,
  LabelDetectionStepProcessor,
  ObjectTrackingStepProcessor,
  FaceDetectionStepProcessor,
  PersonDetectionStepProcessor,
  SpeechTranscriptionStepProcessor,
} from './processors/index';
import {
  LabelDetectionExecutor,
  ObjectTrackingExecutor,
  FaceDetectionExecutor,
  PersonDetectionExecutor,
  SpeechTranscriptionExecutor,
} from './executors/index';

import { LabelCacheService } from './services/label-cache.service';
import { LabelEntityService } from './services/label-entity.service';
import {
  LabelDetectionNormalizer,
  ObjectTrackingNormalizer,
  FaceDetectionNormalizer,
  PersonDetectionNormalizer,
  SpeechTranscriptionNormalizer,
} from './normalizers/index';

@Module({
  imports: [SharedModule, QueueModule],
  providers: [
    // Configuration
    ProcessorsConfigService,

    // Service
    LabelsService,

    // Executors
    LabelDetectionExecutor,
    ObjectTrackingExecutor,
    FaceDetectionExecutor,
    PersonDetectionExecutor,
    SpeechTranscriptionExecutor,

    // Services
    LabelCacheService,
    LabelEntityService,

    // Normalizers
    LabelDetectionNormalizer,
    ObjectTrackingNormalizer,
    FaceDetectionNormalizer,
    PersonDetectionNormalizer,
    SpeechTranscriptionNormalizer,

    // Processors
    DetectLabelsParentProcessor,
    UploadToGcsStepProcessor,
    LabelDetectionStepProcessor,
    ObjectTrackingStepProcessor,
    FaceDetectionStepProcessor,
    PersonDetectionStepProcessor,
    SpeechTranscriptionStepProcessor,
  ],
  exports: [
    LabelsService,
    LabelCacheService,
    LabelEntityService,
    ProcessorsConfigService,
  ],
})
export class LabelsModule {}
