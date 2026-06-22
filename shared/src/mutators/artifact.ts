import { RecordService } from 'pocketbase';
import type { ListResult } from 'pocketbase';
import { ArtifactInputSchema } from '../schema';
import type { Artifact, ArtifactInput } from '../schema';
import type { TypedPocketBase } from '../types';
import { ArtifactStatus } from '../enums';
import { BaseMutator, type MutatorOptions } from './base';

export class ArtifactMutator extends BaseMutator<Artifact, ArtifactInput> {
  constructor(pb: TypedPocketBase, options?: Partial<MutatorOptions>) {
    super(pb, options);
  }

  protected getCollection(): RecordService<Artifact> {
    return this.pb.collection('Artifacts');
  }

  protected setDefaults(): MutatorOptions {
    return {
      expand: [],
      filter: [],
      // Oldest first so the reaper drains the backlog in FIFO order.
      sort: ['created'],
    };
  }

  protected async validateInput(input: ArtifactInput): Promise<ArtifactInput> {
    return ArtifactInputSchema.parse(input);
  }

  /**
   * Get artifacts still awaiting deletion.
   * @param perPage Items per page (default: 200)
   * @param page Page number (default: 1)
   */
  async getPending(perPage = 200, page = 1): Promise<ListResult<Artifact>> {
    return this.getList(
      page,
      perPage,
      this.pb.filter('status = {:status}', {
        status: ArtifactStatus.PENDING,
      })
    );
  }

  /**
   * Record a failed reap attempt: bump the attempt counter and store the error.
   * @param id The artifact ID
   * @param errorLog The failure message (truncated to 500 chars)
   * @param attempts The current attempt count
   */
  async markFailed(
    id: string,
    errorLog: string,
    attempts: number
  ): Promise<Artifact> {
    const truncated =
      errorLog.length > 500 ? errorLog.substring(0, 497) + '...' : errorLog;
    return this.update(id, {
      status: ArtifactStatus.FAILED,
      errorLog: truncated,
      attempts: attempts + 1,
    } as Partial<Artifact>);
  }
}
