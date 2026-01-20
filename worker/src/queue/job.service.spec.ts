import { Test, TestingModule } from '@nestjs/testing';
import { expect, vi, describe, it, beforeEach } from 'vitest';
import { JobService } from './job.service';
import { FlowService } from './flow.service';
import { TaskType } from '@project/shared';
import { DetectLabelsStepType } from './types/step.types';

describe('JobService', () => {
  let service: JobService;
  let flowService: FlowService;

  const mockFlowService = {
    addFlow: vi.fn(),
  };

  beforeEach(async () => {
    mockFlowService.addFlow.mockReset();
    mockFlowService.addFlow.mockResolvedValue('mock-job-id');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobService,
        {
          provide: FlowService,
          useValue: mockFlowService,
        },
      ],
    }).compile();

    service = module.get<JobService>(JobService);
    flowService = module.get<FlowService>(FlowService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
    expect(flowService).toBeDefined();
  });

  describe('submitTranscodeJob', () => {
    it('should build and submit transcode flow', async () => {
      const task = {
        id: 'task-1',
        type: TaskType.PROCESS_UPLOAD,
        payload: { uploadId: 'u-1' },
      } as any;
      const result = await service.submitTranscodeJob(task);

      expect(mockFlowService.addFlow).toHaveBeenCalled();
      expect(result).toBe('mock-job-id');
    });
  });

  describe('submitFullIngestJob', () => {
    it('should chain transcode flow as dependency of labels flow', async () => {
      const transcodeTask = {
        id: 't-1',
        type: TaskType.PROCESS_UPLOAD,
        payload: { uploadId: 'u-1' },
      } as any;
      const labelsTask = {
        id: 'l-1',
        type: TaskType.DETECT_LABELS,
        payload: { mediaId: 'm-1', fileRef: 'f-1', config: {} },
      } as any;

      await service.submitFullIngestJob(transcodeTask, labelsTask);

      expect(mockFlowService.addFlow).toHaveBeenCalledWith(
        expect.objectContaining({
          children: expect.arrayContaining([
            expect.objectContaining({
              name: DetectLabelsStepType.UPLOAD_TO_GCS,
              children: expect.arrayContaining([
                expect.objectContaining({
                  name: 'parent',
                }),
              ]),
            }),
          ]),
        })
      );
    });
  });
});
