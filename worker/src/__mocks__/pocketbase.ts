import { TypedPocketBase } from '@project/shared';
import { vi, type Mock } from 'vitest';

// Create a factory function for collection mock that returns a new object each time
const createCollectionMock = () => ({
  authWithPassword: vi.fn().mockResolvedValue({}),
});

export const mockPocketBaseInstance: Partial<TypedPocketBase> & {
  autoCancellation: Mock;
  collection: Mock;
  health: {
    check: Mock;
  };
} = {
  autoCancellation: vi.fn(),
  collection: vi.fn().mockImplementation(() => createCollectionMock()),
  health: {
    check: vi.fn().mockResolvedValue({}),
  },
} as Partial<TypedPocketBase> & {
  autoCancellation: Mock;
  collection: Mock;
  health: {
    check: Mock;
  };
};

export const pocketBaseCtor: Mock = vi.fn();

export default class PocketBaseMock {
  constructor(url: string) {
    pocketBaseCtor(url);
    return mockPocketBaseInstance as unknown as TypedPocketBase;
  }
}
