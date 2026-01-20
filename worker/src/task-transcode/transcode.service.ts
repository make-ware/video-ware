import { Injectable, Logger } from '@nestjs/common';

/**
 * Transcode Service
 *
 * Placeholder service for transcode operations.
 * Flow building logic has been moved to queue/flows/transcode-flow.builder.ts
 *
 * This service can be used for transcode-specific business logic that doesn't
 * belong in the flow builder or processors.
 */
@Injectable()
export class TranscodeService {
  private readonly logger = new Logger(TranscodeService.name);

  constructor() {
    this.logger.log('TranscodeService initialized');
  }

  // Add transcode-specific business logic methods here if needed
}
