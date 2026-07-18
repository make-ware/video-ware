import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { GoogleCloudService } from '../google-cloud.service';

/**
 * Tests for GoogleCloudService.annotateVideoAndWait — the quota-aware
 * AnnotateVideo wrapper. The backoff delays are hardcoded constants, so the
 * service's `sleep` is stubbed (see beforeEach) to run the loops instantly.
 */

const QUOTA_ERROR = Object.assign(
  new Error(
    "8 RESOURCE_EXHAUSTED: Quota exceeded for quota metric 'Requests' and " +
      "limit 'Requests per minute' of service 'videointelligence.googleapis.com'"
  ),
  { code: 8 }
);

function makeService(): GoogleCloudService {
  const config = {
    'google.projectId': 'test-project',
  } as Record<string, unknown>;

  const configService = {
    get: vi.fn((key: string, defaultValue?: unknown) =>
      key in config ? config[key] : defaultValue
    ),
  } as unknown as ConfigService;

  return new GoogleCloudService(configService);
}

interface MockOperation {
  name: string;
  done: boolean;
  error?: Error;
  result: unknown;
  getOperation: ReturnType<typeof vi.fn>;
}

function makeOperation(): MockOperation {
  return {
    name: 'projects/p/locations/l/operations/123',
    done: false,
    error: undefined,
    result: null,
    getOperation: vi.fn(),
  };
}

describe('GoogleCloudService.annotateVideoAndWait', () => {
  let service: GoogleCloudService;
  let operation: MockOperation;
  let annotateVideo: ReturnType<typeof vi.fn>;

  const request = { inputUri: 'gs://bucket/temp/ws/media' };
  const response = { annotationResults: [{ segment: {} }] };

  beforeEach(() => {
    service = makeService();
    // Delays are hardcoded constants; skip the real waits so loops run fast.
    vi.spyOn(
      service as unknown as { sleep: (ms: number) => Promise<void> },
      'sleep'
    ).mockResolvedValue(undefined);
    operation = makeOperation();
    annotateVideo = vi.fn().mockResolvedValue([operation]);
    // Inject the mock client (onModuleInit is never run in unit tests)
    (
      service as unknown as { videoIntelligenceClient: unknown }
    ).videoIntelligenceClient = { annotateVideo };
  });

  it('reserves a shared request-gate slot for the submit and every poll', async () => {
    // The gate is what keeps CONCURRENT operations under the per-minute
    // quota: submits and polls of all in-flight operations share one
    // minimum-interval clock. Here we assert every request goes through it.
    const gate = (
      service as unknown as { requestGate: { wait: () => Promise<void> } }
    ).requestGate;
    const waitSpy = vi.spyOn(gate, 'wait');

    operation.getOperation
      .mockResolvedValueOnce([null, {}, {}]) // still running
      .mockImplementationOnce(() => {
        operation.done = true;
        operation.result = response;
        return Promise.resolve([response, {}, {}]);
      });

    await expect(service.annotateVideoAndWait(request)).resolves.toBe(response);
    // 1 AnnotateVideo submit + 2 GetOperation polls
    expect(waitSpy).toHaveBeenCalledTimes(3);
  });

  it('starts the operation and polls until done', async () => {
    operation.getOperation
      .mockResolvedValueOnce([null, {}, {}]) // still running
      .mockImplementationOnce(() => {
        operation.done = true;
        operation.result = response;
        return Promise.resolve([response, {}, {}]);
      });

    await expect(service.annotateVideoAndWait(request)).resolves.toBe(response);
    expect(annotateVideo).toHaveBeenCalledTimes(1);
    expect(operation.getOperation).toHaveBeenCalledTimes(2);
  });

  it('retries the initial AnnotateVideo call on RESOURCE_EXHAUSTED', async () => {
    annotateVideo
      .mockRejectedValueOnce(QUOTA_ERROR)
      .mockRejectedValueOnce(QUOTA_ERROR)
      .mockResolvedValueOnce([operation]);
    operation.getOperation.mockImplementationOnce(() => {
      operation.done = true;
      operation.result = response;
      return Promise.resolve([response, {}, {}]);
    });

    await expect(service.annotateVideoAndWait(request)).resolves.toBe(response);
    expect(annotateVideo).toHaveBeenCalledTimes(3);
  });

  it('does NOT re-issue AnnotateVideo when a poll hits the quota', async () => {
    operation.getOperation
      .mockRejectedValueOnce(QUOTA_ERROR) // transport-level quota rejection
      .mockImplementationOnce(() => {
        operation.done = true;
        operation.result = response;
        return Promise.resolve([response, {}, {}]);
      });

    await expect(service.annotateVideoAndWait(request)).resolves.toBe(response);
    // The operation kept running server-side; only the poll was retried
    expect(annotateVideo).toHaveBeenCalledTimes(1);
    expect(operation.getOperation).toHaveBeenCalledTimes(2);
  });

  it('propagates a non-quota error from the initial call immediately', async () => {
    const notFound = Object.assign(new Error('5 NOT_FOUND: no such object'), {
      code: 5,
    });
    annotateVideo.mockRejectedValue(notFound);

    await expect(service.annotateVideoAndWait(request)).rejects.toBe(notFound);
    expect(annotateVideo).toHaveBeenCalledTimes(1);
  });

  it('propagates an operation-level failure without retrying', async () => {
    const opError = Object.assign(new Error('annotation failed'), { code: 3 });
    operation.getOperation.mockImplementation(() => {
      operation.error = opError; // gax records operation failures here
      return Promise.reject(opError);
    });

    await expect(service.annotateVideoAndWait(request)).rejects.toBe(opError);
    expect(operation.getOperation).toHaveBeenCalledTimes(1);
  });

  it('treats an operation-level quota error as final once recorded', async () => {
    // If the OPERATION itself completed with a RESOURCE_EXHAUSTED error,
    // retrying the poll would replay the cached rejection forever.
    operation.getOperation.mockImplementation(() => {
      operation.error = QUOTA_ERROR;
      return Promise.reject(QUOTA_ERROR);
    });

    await expect(service.annotateVideoAndWait(request)).rejects.toBe(
      QUOTA_ERROR
    );
    expect(operation.getOperation).toHaveBeenCalledTimes(1);
  });
});
