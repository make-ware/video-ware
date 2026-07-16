import { RecordService } from 'pocketbase';
import { BaseMutator } from './base';
import type { LabelJob, LabelJobInput, Task } from '../schema';
import { LabelJobInputSchema } from '../schema';

export interface LabelJobRelations {
  TaskRef?: Task;
}

export class LabelJobMutator extends BaseMutator<
  LabelJob,
  LabelJobInput,
  LabelJobRelations
> {
  protected getCollection(): RecordService<LabelJob> {
    return this.pb.collection('LabelJobs');
  }

  protected async validateInput(input: LabelJobInput): Promise<LabelJobInput> {
    return LabelJobInputSchema.parse(input);
  }

  async getByMedia(mediaId: string): Promise<LabelJob[]> {
    const filter = this.pb.filter('MediaRef = {:mediaId}', { mediaId });
    try {
      const result = await this.getList(1, 50, filter, '-created', ['TaskRef']);
      return result.items;
    } catch {
      // Fallback without expand if TaskRef relation is stale/deleted
      const result = await this.getList(1, 50, filter, '-created');
      return result.items;
    }
  }

  async getByType(mediaId: string, type: string): Promise<LabelJob | null> {
    const filter = this.pb.filter(
      'MediaRef = {:mediaId} && jobType = {:type}',
      { mediaId, type }
    );
    try {
      return await this.getFirstByFilter(filter, ['TaskRef'], '-created');
    } catch {
      // Fallback without expand if TaskRef relation is stale/deleted
      return this.getFirstByFilter(filter, undefined, '-created');
    }
  }

  /**
   * Point the media's LabelJob record for a job type at the given task,
   * creating the record if it doesn't exist yet. Keeps LabelJobs an index of
   * "the last task that ran this type" regardless of who created the task.
   */
  async upsertForTask(
    mediaId: string,
    jobType: string,
    taskId: string
  ): Promise<LabelJob> {
    const existing = await this.getByType(mediaId, jobType);
    if (existing) {
      return this.update(existing.id, { TaskRef: taskId });
    }
    return this.create({ MediaRef: mediaId, jobType, TaskRef: taskId });
  }
}
