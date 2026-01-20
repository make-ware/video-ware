import { RecordService } from 'pocketbase';
import { type User, type UserInput, UserInputSchema } from '../schema';
import type { TypedPocketBase } from '../types';
import { BaseMutator } from './base';

export class UserMutator extends BaseMutator<User, UserInput> {
  constructor(pb: TypedPocketBase) {
    super(pb);
  }

  protected getCollection(): RecordService<User> {
    return this.pb.collection('Users');
  }

  /**
   * Override create to handle passwordConfirm for PocketBase auth collections
   * PocketBase requires passwordConfirm when creating users in auth collections
   */
  async create(input: UserInput): Promise<User> {
    try {
      // Validate the input using the schema
      const validated = UserInputSchema.parse(input);

      // Extract passwordConfirm before removing it from the data
      const { passwordConfirm, ...dataWithoutConfirm } = validated;

      // Create the user with passwordConfirm (required by PocketBase for auth collections)
      const record = await this.getCollection().create({
        ...dataWithoutConfirm,
        passwordConfirm, // Include passwordConfirm for PocketBase
      } as Record<string, unknown>);

      return await this.processRecord(record);
    } catch (error) {
      return this.errorWrapper(error);
    }
  }

  protected async validateInput(input: UserInput): Promise<UserInput> {
    // Validate the input using the schema
    const validated = UserInputSchema.parse(input);
    // Return without passwordConfirm for database operations (it's only for validation)
    const { passwordConfirm, ...result } = validated;
    // passwordConfirm is only used for validation, not stored in database
    void passwordConfirm;
    return result as UserInput;
  }
}
