import { BaseMutator } from './base';
import {
  UsageEvent,
  UsageEventInput,
  UsageEventSchema,
  UsageEventInputSchema,
} from '../schema/usage-events';
import { RecordService } from 'pocketbase';

export class UsageEventMutator extends BaseMutator<
  UsageEvent,
  UsageEventInput
> {
  protected readonly collectionName = 'UsageEvents';
  protected schema = UsageEventSchema;

  protected getCollection(): RecordService<UsageEvent> {
    return this.pb.collection(this.collectionName);
  }

  protected async validateInput(
    input: UsageEventInput
  ): Promise<UsageEventInput> {
    return UsageEventInputSchema.parse(input);
  }
}
