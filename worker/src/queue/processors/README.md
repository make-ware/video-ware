# BullMQ Processor Base Classes

This directory contains base classes for BullMQ job processors, providing a consistent foundation for task processing with automatic status updates, progress tracking, and error handling.

## Core Principles

### Idempotent Job Design

**All jobs must be idempotent** - they can be safely retried without side effects:

1. **Job data contains only configuration** - never execution state
2. **Execution artifacts live in database/filesystem** - not in job data
3. **Steps check for existing work** - before performing operations
4. **Cached results enable retry optimization** - completed steps aren't re-executed

**Example of idempotent job data:**
```typescript
// ✅ Good: Configuration only
const jobData = {
  taskId: 'task_123',
  workspaceId: 'ws_456',
  input: {
    mediaId: 'media_789',
    version: 1,
    config: { /* processing config */ }
  }
};

// ❌ Bad: Contains execution state
const jobData = {
  taskId: 'task_123',
  uploadedFiles: ['file1.mp4'], // Execution artifact
  processedCount: 5,             // Execution state
  lastProcessedAt: '2024-01-01'  // Execution state
};
```

### Checking for Existing Work

Steps should check database/filesystem before performing work:

```typescript
async process(input: MyStepInput, job: Job<StepJobData>): Promise<MyStepOutput> {
  // Check if work already exists
  const existing = await this.db.findExistingResult(input.mediaId, input.version);
  if (existing) {
    this.logger.log('Using existing result, skipping processing');
    return existing;
  }
  
  // Perform work only if needed
  const result = await this.performWork(input);
  await this.db.saveResult(result);
  return result;
}
```

## Class Hierarchy

```
BaseProcessor (abstract)
├── BaseSimpleProcessor (abstract)
└── BaseFlowProcessor (abstract)
    └── BaseParentProcessor (deprecated, use BaseFlowProcessor)
```

## BaseProcessor

**Purpose:** Foundation for all BullMQ processors

**Provides:**
- PocketBase integration for task updates
- Task status management
- Error formatting and logging utilities
- Common helper methods

**When to use:** Never directly - always extend one of the specialized subclasses

**Abstract requirements:**
- `logger: Logger` - NestJS logger instance
- `pocketbaseService: PocketBaseService` - PocketBase service for task updates

**Example:**
```typescript
// Don't extend BaseProcessor directly
// Use BaseSimpleProcessor or BaseFlowProcessor instead
```

---

## BaseSimpleProcessor

**Purpose:** For standalone jobs without parent-child relationships

**Provides:**
- Automatic task status updates (RUNNING → SUCCESS/FAILED)
- Progress tracking
- Error handling with retry logic
- Job lifecycle event handlers

**When to use:**
- Single-step jobs
- Jobs that don't orchestrate other jobs
- Independent background tasks

**Abstract requirements:**
- `process(job: Job<TJobData>): Promise<TResult>` - Main job processing logic
- `logger: Logger` - NestJS logger instance
- `pocketbaseService: PocketBaseService` - PocketBase service

**Example:**
```typescript
import { Injectable, Logger } from '@nestjs/common';
import { BaseSimpleProcessor, SimpleJobData } from './base-simple.processor';
import { PocketBaseService } from '../../shared/services/pocketbase.service';

interface EmailJobData extends SimpleJobData {
  to: string;
  subject: string;
  body: string;
}

@Injectable()
export class SendEmailProcessor extends BaseSimpleProcessor<EmailJobData> {
  protected readonly logger = new Logger(SendEmailProcessor.name);

  constructor(protected readonly pocketbaseService: PocketBaseService) {
    super();
  }

  async process(job: Job<EmailJobData>): Promise<void> {
    const { to, subject, body } = job.data;
    
    // Send email logic here
    await this.emailService.send(to, subject, body);
    
    // Progress updates are automatic via job.updateProgress()
    await job.updateProgress(50);
    
    // Task status updates happen automatically on completion/failure
  }
}
```

---

## BaseFlowProcessor

**Purpose:** For flow jobs with parent-child orchestration (BullMQ flows)

**Provides:**
- Parent job orchestration
- Child step coordination
- Progress aggregation across steps
- Error handling and retry logic for steps
- Task result aggregation
- Automatic step tracking

**When to use:**
- Multi-step workflows
- Jobs that orchestrate child jobs
- Complex pipelines with dependencies

**Abstract requirements:**
- `processParentJob(job: Job<ParentJobData>): Promise<void>` - Orchestrate child steps
- `processStepJob(job: Job<StepJobData>): Promise<StepResult>` - Process individual steps
- `getQueue(): Queue` - Return the queue instance
- `logger: Logger` - NestJS logger instance
- `pocketbaseService: PocketBaseService` - PocketBase service

**Example:**
```typescript
import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, FlowProducer } from 'bullmq';
import {
  BaseFlowProcessor,
  ParentJobData,
  StepJobData,
  StepResult,
} from './base-flow.processor';
import { PocketBaseService } from '../../shared/services/pocketbase.service';

interface VideoProcessingData extends ParentJobData {
  videoId: string;
  steps: ['download', 'transcode', 'upload'];
}

@Injectable()
export class VideoProcessingProcessor extends BaseFlowProcessor {
  protected readonly logger = new Logger(VideoProcessingProcessor.name);

  constructor(
    @InjectQueue('video-processing') private readonly queue: Queue,
    protected readonly pocketbaseService: PocketBaseService
  ) {
    super();
  }

  protected getQueue(): Queue {
    return this.queue;
  }

  protected async processParentJob(job: Job<VideoProcessingData>): Promise<void> {
    const { taskId, videoId, steps } = job.data;

    // Create child jobs using FlowProducer
    const flow = new FlowProducer({ connection: this.queue.opts.connection });
    
    const children = steps.map((stepType, index) => ({
      name: stepType,
      data: {
        taskId,
        parentJobId: job.id,
        stepType,
        videoId,
      } as StepJobData,
      queueName: 'video-processing',
      opts: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      },
    }));

    await flow.add({
      name: 'parent',
      data: job.data,
      queueName: 'video-processing',
      children,
    });

    this.logger.log(`Created ${steps.length} child jobs for task ${taskId}`);
  }

  protected async processStepJob(job: Job<StepJobData>): Promise<StepResult> {
    const { stepType, videoId } = job.data;
    const startedAt = new Date().toISOString();

    try {
      switch (stepType) {
        case 'download':
          await this.downloadVideo(videoId);
          break;
        case 'transcode':
          await this.transcodeVideo(videoId);
          break;
        case 'upload':
          await this.uploadVideo(videoId);
          break;
        default:
          throw new Error(`Unknown step type: ${stepType}`);
      }

      return {
        stepType,
        status: 'completed',
        startedAt,
        completedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        stepType,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        startedAt,
        completedAt: new Date().toISOString(),
      };
    }
  }

  private async downloadVideo(videoId: string): Promise<void> {
    // Download logic
  }

  private async transcodeVideo(videoId: string): Promise<void> {
    // Transcode logic
  }

  private async uploadVideo(videoId: string): Promise<void> {
    // Upload logic
  }
}
```

---

## BaseParentProcessor (Deprecated)

**Status:** Deprecated - use `BaseFlowProcessor` instead

This class is maintained for backward compatibility with existing code. It extends `BaseFlowProcessor` and provides the same functionality.

**Migration:**
```typescript
// Old
import { BaseParentProcessor } from './base-parent.processor';
export class MyProcessor extends BaseParentProcessor { }

// New
import { BaseFlowProcessor } from './base-flow.processor';
export class MyProcessor extends BaseFlowProcessor { }
```

---

## Type Definitions

### SimpleJobData
```typescript
interface SimpleJobData {
  taskId: string;
  workspaceId: string;
  input: unknown; // Job-specific configuration input
  [key: string]: unknown; // Additional configuration data
}
```

**Idempotency:** Contains only configuration. Execution artifacts stored in database/filesystem.

### ParentJobData
```typescript
interface ParentJobData {
  taskId: string;
  workspaceId: string;
  stepResults: Record<string, StepResult>; // Cache of completed steps
  [key: string]: unknown; // Additional configuration data
}
```

**Idempotency:** 
- Configuration only in custom fields
- `stepResults` is a cache for retry optimization (completed steps aren't re-executed)
- Execution artifacts stored in database/filesystem

### StepJobData
```typescript
interface StepJobData {
  taskId: string;
  workspaceId: string;
  parentJobId: string;
  stepType: string;
  input: unknown; // Step-specific configuration input
  [key: string]: unknown; // Additional configuration data
}
```

**Idempotency:** Contains only configuration. Execution artifacts stored in database/filesystem.

### StepResult
```typescript
interface StepResult {
  stepType: string;
  status: 'running' | 'completed' | 'failed';
  error?: string;
  startedAt?: string;
  completedAt?: string;
  data?: unknown;
}
```

### TaskResult
```typescript
interface TaskResult {
  steps: Record<string, StepResult>;
  completedSteps: string[];
  failedSteps: string[];
  currentStep?: string;
  totalSteps: number;
  completedCount: number;
  failedCount: number;
  startedAt?: string;
  completedAt?: string;
}
```

---

## Features

### Automatic Task Status Updates

All processors automatically update task status in PocketBase:
- `RUNNING` - When job becomes active
- `SUCCESS` - When job completes successfully
- `FAILED` - When job fails after all retries

### Progress Tracking

**Simple jobs:**
- Call `job.updateProgress(percentage)` in your process method
- Progress is automatically synced to PocketBase

**Flow jobs:**
- Progress is calculated based on completed steps
- Each step contributes equally to overall progress
- In-progress steps add a small bonus (5%)

### Error Handling

**Retry logic:**
- Failed jobs are automatically retried (default: 3 attempts)
- Task status remains `RUNNING` during retries
- Task status changes to `FAILED` only after all retries exhausted

**Error logging:**
- Errors are formatted and stored in task `errorLog` field
- Includes timestamp, step name, error message, and stack trace
- Flow jobs aggregate errors from all failed steps

### Event Handlers

All processors handle these BullMQ events:
- `active` - Job starts processing
- `completed` - Job finishes successfully
- `failed` - Job fails
- `progress` - Job reports progress (simple jobs only)

---

## Best Practices

1. **Choose the right base class:**
   - Use `BaseSimpleProcessor` for standalone jobs
   - Use `BaseFlowProcessor` for multi-step workflows

2. **Implement required methods:**
   - Always implement all abstract methods
   - Return proper types from `process` methods

3. **Progress updates:**
   - Simple jobs: Call `job.updateProgress()` at key milestones
   - Flow jobs: Progress is automatic based on step completion

4. **Error handling:**
   - Let errors bubble up - base classes handle them
   - Return failed `StepResult` for recoverable step failures
   - Throw errors for unrecoverable failures

5. **Logging:**
   - Use the provided logger instance
   - Log at appropriate levels (debug, log, warn, error)
   - Include relevant context (taskId, stepType, etc.)

6. **Testing:**
   - Mock `pocketbaseService` in tests
   - Test both success and failure paths
   - Verify progress calculations for flow jobs
