import { Injectable, Logger } from '@nestjs/common';

/**
 * Render Service
 *
 * Placeholder service for render operations.
 * Flow building logic has been moved to queue/flows/render-flow.builder.ts
 *
 * This service can be used for render-specific business logic that doesn't
 * belong in the flow builder or processors.
 */
@Injectable()
export class RenderService {
  private readonly logger = new Logger(RenderService.name);

  constructor() {
    this.logger.log('RenderService initialized');
  }

  // Add render-specific business logic methods here if needed
}
