import { Injectable, Logger, Inject } from '@nestjs/common';
import { Task } from '@project/shared';
import { FlowService } from './flow.service';
import {
  TranscodeFlowBuilder,
  LabelsFlowBuilder,
  RenderFlowBuilder,
  FlowDefinition,
} from './flows';
import { DetectLabelsStepType } from './types/step.types';

@Injectable()
export class JobService {
  private readonly logger = new Logger(JobService.name);

  constructor(@Inject(FlowService) private readonly flowService: FlowService) {}

  async submitTranscodeJob(task: Task): Promise<string> {
    this.logger.log(`Submitting transcode job for task ${task.id}`);
    const flow = TranscodeFlowBuilder.buildFlow(task);
    return this.flowService.addFlow(flow);
  }

  async submitLabelsJob(task: Task): Promise<string> {
    this.logger.log(`Submitting labels job for task ${task.id}`);
    const flow = LabelsFlowBuilder.buildFlow(task);
    return this.flowService.addFlow(flow);
  }

  async submitRenderJob(task: Task): Promise<string> {
    this.logger.log(`Submitting render job for task ${task.id}`);
    const flow = RenderFlowBuilder.buildFlow(task);
    return this.flowService.addFlow(flow);
  }

  async submitFullIngestJob(
    transcodeTask: Task,
    labelsTask?: Task
  ): Promise<string> {
    this.logger.log(`Submitting full ingest job`);

    const actualLabelsTask = labelsTask || transcodeTask;

    const transcodeFlow = TranscodeFlowBuilder.buildFlow(transcodeTask);
    const labelsFlow = LabelsFlowBuilder.buildFlow(actualLabelsTask);

    const uploadStep = labelsFlow.children.find(
      (c: any) => c.name === DetectLabelsStepType.UPLOAD_TO_GCS
    );

    if (uploadStep) {
      if (!uploadStep.children) uploadStep.children = [];
      uploadStep.children.push(transcodeFlow as any);
    } else {
      labelsFlow.children.push(transcodeFlow as any);
    }

    return this.flowService.addFlow(labelsFlow);
  }

  async submitCompositeJob(
    name: string,
    queueName: string,
    data: any,
    steps: any[]
  ): Promise<string> {
    this.logger.log(`Submitting composite job: ${name}`);
    return this.flowService.addFlow({
      name,
      queueName,
      data,
      children: steps,
    } as any);
  }

  async submitFlow(flow: FlowDefinition): Promise<string> {
    return this.flowService.addFlow(flow);
  }
}
