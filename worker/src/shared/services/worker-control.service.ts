import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';

/**
 * Service to manage and track the worker application's lifecycle.
 * Used to ensure that background workers don't start processing jobs
 * until the entire NestJS application and all its services are fully initialized.
 */
@Injectable()
export class WorkerControlService implements OnApplicationBootstrap {
  private readonly logger = new Logger(WorkerControlService.name);
  private isReady = false;
  private readyPromise: Promise<void>;
  private resolveReady!: () => void;

  constructor() {
    this.readyPromise = new Promise((resolve) => {
      this.resolveReady = resolve;
    });
  }

  /**
   * Called by NestJS after all modules have been initialized and
   * the application has finished bootstrapping.
   */
  onApplicationBootstrap() {
    this.isReady = true;
    this.resolveReady();
    this.logger.log(
      'Application fully bootstrapped. Workers are now allowed to process jobs.'
    );
  }

  /**
   * Wait for the application to be fully bootstrapped.
   * Useful in job processors to prevent premature execution.
   */
  async waitForReady(): Promise<void> {
    if (this.isReady) {
      return;
    }
    this.logger.debug(
      'Waiting for application bootstrap before processing job...'
    );
    await this.readyPromise;
  }

  /**
   * Check if the application is ready.
   */
  getStatus(): boolean {
    return this.isReady;
  }
}
