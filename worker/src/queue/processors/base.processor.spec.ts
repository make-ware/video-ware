import { expect, vi, describe, it, beforeEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { TaskStatus } from '@project/shared';
import { BaseProcessor } from './base.processor';
import type { PocketBaseService } from '../../shared/services/pocketbase.service';

const mockPocketBaseService = {
  getTask: vi.fn(),
  updateTask: vi.fn(),
};

class TestProcessor extends BaseProcessor {
  protected readonly logger = new Logger(TestProcessor.name);
  protected readonly pocketbaseService =
    mockPocketBaseService as unknown as PocketBaseService;

  async process(): Promise<void> {}

  // Expose the protected method under test
  async update(
    taskId: string,
    updates: Parameters<BaseProcessor['updateTask']>[1]
  ) {
    return this.updateTask(taskId, updates);
  }
}

describe('BaseProcessor.updateTask terminal-status handling', () => {
  let processor: TestProcessor;

  beforeEach(() => {
    mockPocketBaseService.getTask.mockReset();
    mockPocketBaseService.updateTask.mockReset();
    mockPocketBaseService.updateTask.mockResolvedValue({});
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    processor = new TestProcessor();
  });

  it('writes through for a non-terminal task', async () => {
    mockPocketBaseService.getTask.mockResolvedValue({
      id: 't-1',
      status: TaskStatus.RUNNING,
    });

    await processor.update('t-1', { status: TaskStatus.SUCCESS });

    expect(mockPocketBaseService.updateTask).toHaveBeenCalledWith('t-1', {
      status: TaskStatus.SUCCESS,
    });
  });

  it('skips updates for a task already in SUCCESS', async () => {
    mockPocketBaseService.getTask.mockResolvedValue({
      id: 't-1',
      status: TaskStatus.SUCCESS,
    });

    await processor.update('t-1', { status: TaskStatus.RUNNING });

    expect(mockPocketBaseService.updateTask).not.toHaveBeenCalled();
  });

  it('skips updates for a task failed with a non-watchdog error', async () => {
    mockPocketBaseService.getTask.mockResolvedValue({
      id: 't-1',
      status: TaskStatus.FAILED,
      errorLog: 'step exhausted retries',
    });

    await processor.update('t-1', { status: TaskStatus.SUCCESS });

    expect(mockPocketBaseService.updateTask).not.toHaveBeenCalled();
  });

  it('skips updates for a canceled task even with a watchdog-style errorLog', async () => {
    mockPocketBaseService.getTask.mockResolvedValue({
      id: 't-1',
      status: TaskStatus.CANCELED,
      errorLog: 'watchdog: task stuck in "running" for 176m',
    });

    await processor.update('t-1', { status: TaskStatus.SUCCESS });

    expect(mockPocketBaseService.updateTask).not.toHaveBeenCalled();
  });

  it('lets a status-bearing event take back a watchdog-failed task and clears the note', async () => {
    mockPocketBaseService.getTask.mockResolvedValue({
      id: 't-1',
      status: TaskStatus.FAILED,
      errorLog: 'watchdog: task stuck in "running" for 176m',
    });

    await processor.update('t-1', {
      status: TaskStatus.SUCCESS,
      result: { steps: {} } as never,
    });

    expect(mockPocketBaseService.updateTask).toHaveBeenCalledWith('t-1', {
      status: TaskStatus.SUCCESS,
      result: { steps: {} },
      errorLog: '',
    });
  });

  it('keeps an update-provided errorLog when taking back a watchdog-failed task', async () => {
    mockPocketBaseService.getTask.mockResolvedValue({
      id: 't-1',
      status: TaskStatus.FAILED,
      errorLog: 'watchdog: task stuck in "running" for 176m',
    });

    await processor.update('t-1', {
      status: TaskStatus.FAILED,
      errorLog: 'real step failure',
    });

    expect(mockPocketBaseService.updateTask).toHaveBeenCalledWith('t-1', {
      status: TaskStatus.FAILED,
      errorLog: 'real step failure',
    });
  });

  it('skips a status-less update on a watchdog-failed task', async () => {
    mockPocketBaseService.getTask.mockResolvedValue({
      id: 't-1',
      status: TaskStatus.FAILED,
      errorLog: 'watchdog: task stuck in "running" for 176m',
    });

    await processor.update('t-1', { progress: 50 });

    expect(mockPocketBaseService.updateTask).not.toHaveBeenCalled();
  });
});
