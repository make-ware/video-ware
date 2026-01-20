import { Module } from '@nestjs/common';
import { PocketBaseService } from './services/pocketbase.service';
import { StorageService } from './services/storage.service';
import { FFmpegService } from './services/ffmpeg.service';
import { GoogleCloudService } from './services/google-cloud.service';
import { PocketBaseClientService } from './services/pocketbase-client.service';

@Module({
  providers: [
    PocketBaseService,
    PocketBaseClientService,
    StorageService,
    FFmpegService,
    GoogleCloudService,
  ],
  exports: [
    PocketBaseService,
    PocketBaseClientService,
    StorageService,
    FFmpegService,
    GoogleCloudService,
  ],
})
export class SharedModule {}
