import { Test, TestingModule } from '@nestjs/testing';
import { expect, vi, describe, it, beforeEach } from 'vitest';
import { JobService } from './job.service';
import { FlowService } from './flow.service';
import { ProcessorsConfigService } from '../config/processors.config';
import { TaskType } from '@project/shared';
import { DetectLabelsStepType } from './types/step.types';
import type { LabelsChildJobDefinition, LabelsFlowDefinition } from './flows';

describe('JobService', () => {
  let service: JobService;
  let flowService: FlowService;

  const mockFlowService = {
    addFlow: vi.fn(),
  };

  const mockProcessorsConfigService = {
    enableLabelDetection: true,
    enableObjectTracking: true,
    enableFaceDetection: false,
    enablePersonDetection: false,
    enableSpeechTranscription: false,
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
        {
          provide: ProcessorsConfigService,
          useValue: mockProcessorsConfigService,
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

  describe('submitLabelsJob', () => {
    it('should only enqueue detection steps enabled via ENABLE_* flags', async () => {
      const task = {
        id: 'l-1',
        type: TaskType.DETECT_LABELS,
        WorkspaceRef: 'w-1',
        payload: {
          mediaId: 'm-1',
          fileRef: 'f-1',
          config: {
            detectLabels: true,
            detectObjects: true,
            detectFaces: true, // requested but disabled by env
          },
        },
      } as any;

      await service.submitLabelsJob(task);

      const flow = mockFlowService.addFlow.mock
        .calls[0][0] as LabelsFlowDefinition;
      const stepTypes = (flow.children as LabelsChildJobDefinition[]).map(
        (c) => c.data.stepType
      );

      expect(stepTypes).toEqual([
        DetectLabelsStepType.LABEL_DETECTION,
        DetectLabelsStepType.OBJECT_TRACKING,
      ]);
      expect(flow.data.expectedSteps).toEqual(stepTypes);
    });
  });
});
