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
    const filter = `MediaRef = "${mediaId}"`;
    // We sort by jobType to be deterministic, but getting list is enough.
    // The UI will filter/find by type.
    // Pass expand as an array to ensure proper handling
    const result = await this.getList(1, 50, filter, '-created', ['TaskRef']);
    return result.items;
  }

  async getByType(mediaId: string, type: string): Promise<LabelJob | null> {
    const filter = `MediaRef = "${mediaId}" && jobType = "${type}"`;
    // Pass expand as an array to ensure proper handling
    return this.getFirstByFilter(filter, ['TaskRef'], '-created');
  }
}
