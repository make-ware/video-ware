import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UploadService } from '../upload';
import { UploadStatus } from '@project/shared';
import type { TypedPocketBase, Upload } from '@project/shared';

/**
 * retryUpload re-fires the ingest hook (failed -> uploaded) but does NOT
 * re-transfer bytes. It must therefore refuse any record whose original
 * transfer never finished, otherwise the ingest hook would build an empty /
 * corrupt Media from a truncated or absent blob.
 */
function makeService() {
  const pb = {
    authStore: { record: { id: 'user-1' }, token: 'tok' },
    collection: () => ({}),
  } as unknown as TypedPocketBase;

  const service = new UploadService(pb, {});

  const getById = vi.fn<(id: string) => Promise<Upload | null>>();
  const updateStatus = vi.fn<
    (id: string, status: UploadStatus) => Promise<Upload>
  >(async (id, status) => ({ id, status }) as unknown as Upload);
  // Swap the real mutator for a stub so we assert behavior, not PB wiring.
  (service as unknown as { uploadMutator: unknown }).uploadMutator = {
    getById,
    updateStatus,
  };

  return { service, getById, updateStatus };
}

const failedUpload = (over: Partial<Upload>): Upload =>
  ({
    id: 'up-1',
    status: UploadStatus.FAILED,
    size: 1000,
    bytesUploaded: 0,
    externalPath: '',
    ...over,
  }) as unknown as Upload;

describe('UploadService.retryUpload', () => {
  let ctx: ReturnType<typeof makeService>;

  beforeEach(() => {
    ctx = makeService();
  });

  it('throws when the upload is not found', async () => {
    ctx.getById.mockResolvedValue(null);
    await expect(ctx.service.retryUpload('missing')).rejects.toThrow(
      /Upload not found/
    );
    expect(ctx.updateStatus).not.toHaveBeenCalled();
  });

  it('throws when the upload is not in the failed state', async () => {
    ctx.getById.mockResolvedValue(
      failedUpload({ status: UploadStatus.UPLOADED })
    );
    await expect(ctx.service.retryUpload('up-1')).rejects.toThrow(
      /not in failed state/
    );
    expect(ctx.updateStatus).not.toHaveBeenCalled();
  });

  it('refuses an incomplete transfer (no stored original) instead of re-firing ingest', async () => {
    // Failed mid-transfer: finalize never ran, so externalPath is empty and
    // bytesUploaded is 0 — this is the accidental-empty-Media bug.
    ctx.getById.mockResolvedValue(
      failedUpload({ externalPath: '', bytesUploaded: 0, size: 1000 })
    );
    await expect(ctx.service.retryUpload('up-1')).rejects.toThrow(
      /did not finish transferring/
    );
    expect(ctx.updateStatus).not.toHaveBeenCalled();
  });

  it('refuses when fewer bytes were stored than the file size', async () => {
    ctx.getById.mockResolvedValue(
      failedUpload({
        externalPath: 'uploads/ws/up-1/original.mp4',
        bytesUploaded: 400,
        size: 1000,
      })
    );
    await expect(ctx.service.retryUpload('up-1')).rejects.toThrow(
      /did not finish transferring/
    );
    expect(ctx.updateStatus).not.toHaveBeenCalled();
  });

  it('re-fires ingest for a fully transferred upload (bytes already stored)', async () => {
    ctx.getById.mockResolvedValue(
      failedUpload({
        externalPath: 'uploads/ws/up-1/original.mp4',
        bytesUploaded: 1000,
        size: 1000,
      })
    );

    await ctx.service.retryUpload('up-1');

    expect(ctx.updateStatus).toHaveBeenCalledWith(
      'up-1',
      UploadStatus.UPLOADED
    );
  });
});
