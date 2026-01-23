import { Module } from '@nestjs/common';
import { PocketBaseService } from './services/pocketbase.service';
import { StorageService } from './services/storage.service';
import { FFmpegService } from './services/ffmpeg.service';
import { GoogleCloudService } from './services/google-cloud.service';
import { PocketBaseClientService } from './services/pocketbase-client.service';
import { WorkerControlService } from './services/worker-control.service';

@Module({
  providers: [
    PocketBaseService,
    PocketBaseClientService,
    StorageService,
    FFmpegService,
    GoogleCloudService,
    WorkerControlService,
  ],
  exports: [
    PocketBaseService,
    PocketBaseClientService,
    StorageService,
    FFmpegService,
    GoogleCloudService,
    WorkerControlService,
  ],
})
export class SharedModule {}
