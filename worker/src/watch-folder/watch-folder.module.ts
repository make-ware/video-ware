import { Module } from '@nestjs/common';
import { SharedModule } from '../shared/shared.module';
import { WatchFolderService } from './watch-folder.service';

@Module({
  imports: [SharedModule],
  providers: [WatchFolderService],
})
export class WatchFolderModule {}
