import { Injectable, Logger } from '@nestjs/common';

/**
 * Labels Service
 *
 * Placeholder service for label detection operations.
 * Flow building logic has been moved to queue/flows/labels-flow.builder.ts
 *
 * This service can be used for labels-specific business logic that doesn't
 * belong in the flow builder or processors.
 */
@Injectable()
export class LabelsService {
  private readonly logger = new Logger(LabelsService.name);

  constructor() {
    this.logger.log('LabelsService initialized');
  }

  // Add labels-specific business logic methods here if needed
}
