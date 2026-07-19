import { Test, TestingModule } from '@nestjs/testing';
import { expect, vi, describe, it, beforeEach } from 'vitest';
import { JobService } from './job.service';
import { FlowService } from './flow.service';
import { ProcessorsConfigService } from '../config/processors.config';
import { PocketBaseService } from '../shared/services/pocketbase.service';
import { TaskType, ProcessingProvider } from '@project/shared';
import { QUEUE_NAMES } from './queue.constants';
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

  const mockLabelJobMutator = {
    upsertForTask: vi.fn(),
  };

  const mockPocketBaseService = {
    labelJobMutator: mockLabelJobMutator,
    updateTask: vi.fn(),
  };

  beforeEach(async () => {
    mockFlowService.addFlow.mockReset();
    mockFlowService.addFlow.mockResolvedValue('mock-job-id');
    mockLabelJobMutator.upsertForTask.mockReset();
    mockLabelJobMutator.upsertForTask.mockResolvedValue({});
    mockPocketBaseService.updateTask.mockReset();
    mockPocketBaseService.updateTask.mockResolvedValue({});

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
        {
          provide: PocketBaseService,
          useValue: mockPocketBaseService,
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

    it('should upsert a LabelJob for each enqueued detection step', async () => {
      const task = {
        id: 'l-2',
        type: TaskType.DETECT_LABELS,
        WorkspaceRef: 'w-1',
        payload: {
          mediaId: 'm-1',
          fileRef: 'f-1',
          config: {
            detectLabels: true,
            detectObjects: true,
            detectFaces: true, // requested but disabled by env → no upsert
          },
        },
      } as any;

      await service.submitLabelsJob(task);

      expect(mockLabelJobMutator.upsertForTask.mock.calls).toEqual([
        ['m-1', 'shot', 'l-2'],
        ['m-1', 'object', 'l-2'],
      ]);
    });

    it('should not fail the enqueue when the LabelJob sync fails', async () => {
      mockLabelJobMutator.upsertForTask.mockRejectedValue(new Error('pb down'));
      const task = {
        id: 'l-3',
        type: TaskType.DETECT_LABELS,
        WorkspaceRef: 'w-1',
        payload: { mediaId: 'm-1', fileRef: 'f-1', config: {} },
      } as any;

      await expect(service.submitLabelsJob(task)).resolves.toBe('mock-job-id');
    });
  });

  describe('stampEnqueueContext', () => {
    it('stamps bullJobId, queueName and the payload provider on the task', async () => {
      const task = {
        id: 'l-4',
        type: TaskType.DETECT_LABELS,
        WorkspaceRef: 'w-1',
        payload: {
          mediaId: 'm-1',
          fileRef: 'f-1',
          provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
          config: { detectLabels: true },
        },
      } as any;

      await service.submitLabelsJob(task);

      expect(mockPocketBaseService.updateTask).toHaveBeenCalledWith('l-4', {
        bullJobId: 'mock-job-id',
        queueName: QUEUE_NAMES.LABELS,
        provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
      });
    });

    it('falls back to the flow provider when the payload has none', async () => {
      const task = {
        id: 't-1',
        type: TaskType.PROCESS_UPLOAD,
        payload: { uploadId: 'u-1' },
      } as any;

      await service.submitTranscodeJob(task);

      expect(mockPocketBaseService.updateTask).toHaveBeenCalledWith('t-1', {
        bullJobId: 'mock-job-id',
        queueName: QUEUE_NAMES.TRANSCODE,
        provider: ProcessingProvider.FFMPEG,
      });
    });

    it('leaves an already-set record provider untouched', async () => {
      const task = {
        id: 'l-5',
        type: TaskType.DETECT_LABELS,
        WorkspaceRef: 'w-1',
        provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
        payload: { mediaId: 'm-1', fileRef: 'f-1', config: {} },
      } as any;

      await service.submitLabelsJob(task);

      expect(mockPocketBaseService.updateTask).toHaveBeenCalledWith('l-5', {
        bullJobId: 'mock-job-id',
        queueName: QUEUE_NAMES.LABELS,
      });
    });

    it('does not fail the enqueue when the stamp write fails', async () => {
      mockPocketBaseService.updateTask.mockRejectedValue(new Error('pb down'));
      const task = {
        id: 'l-6',
        type: TaskType.DETECT_LABELS,
        WorkspaceRef: 'w-1',
        payload: { mediaId: 'm-1', fileRef: 'f-1', config: {} },
      } as any;

      await expect(service.submitLabelsJob(task)).resolves.toBe('mock-job-id');
    });
  });
});
