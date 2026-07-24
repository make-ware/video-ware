import { Readable } from 'stream';
import type { ReadableStream as WebReadableStream } from 'stream/web';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  ListPartsCommand,
  ListMultipartUploadsCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { StorageBackendType } from '../enums';
import type {
  StorageBackend,
  StorageResult,
  StorageFile,
  PresignedUrl,
  UploadProgress,
  ChunkUploadOptions,
  ChunkUploadResult,
  S3StorageConfig,
} from './types';

interface MultipartUploadState {
  uploadId: string;
  updatedAt: number;
}

/**
 * Cache of in-progress multipart upload ids, keyed by file path.
 *
 * This is only a cache, not the source of truth: clients echo the upload id
 * back with every chunk (ChunkUploadOptions.multipartUploadId), and when both
 * are missing the id is rediscovered from S3 via ListMultipartUploads. Part
 * ETags are never tracked here — finalization reads them back with ListParts —
 * so chunks can land on any server instance and survive restarts.
 *
 * Module-level (process-global) because the chunked-upload route may create a
 * fresh S3StorageBackend per request.
 */
const multipartUploads: Map<string, MultipartUploadState> = new Map();

// Drop multipart state that has been abandoned (client gave up between chunks)
// so the map can't grow unbounded.
const MULTIPART_STATE_TTL_MS = 60 * 60 * 1000; // 1 hour

function pruneStaleMultipartUploads(now: number): void {
  for (const [key, state] of multipartUploads) {
    if (now - state.updatedAt > MULTIPART_STATE_TTL_MS) {
      multipartUploads.delete(key);
    }
  }
}

/** Buffer a web ReadableStream fully into memory (fallback when the chunk's
 * byte length is unknown — S3 needs a length up front to stream). */
async function bufferStream(chunk: ReadableStream): Promise<Buffer> {
  const reader = chunk.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}

/**
 * S3-compatible storage backend implementation
 * Supports AWS S3, MinIO, Backblaze B2, Cloudflare R2, etc.
 */
export class S3StorageBackend implements StorageBackend {
  readonly type = StorageBackendType.S3;
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: S3StorageConfig) {
    this.bucket = config.bucket;

    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: config.forcePathStyle ?? false,
      // Disable the SDK's default data-integrity checksums (enabled by default
      // since aws-sdk-js v3.729). Otherwise UploadPart attaches an
      // x-amz-checksum-crc32 that CompleteMultipartUpload must echo back; since
      // we complete with PartNumber + ETag only, S3-compatible stores such as
      // Garage reject it as "Parts do not match uploaded parts".
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  /**
   * Initialize the storage backend and validate access
   */
  async initialize(): Promise<void> {
    try {
      // Test bucket access by listing objects with maxKeys=1
      await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          MaxKeys: 1,
        })
      );
    } catch (error) {
      throw new Error(
        `Failed to initialize S3 storage for bucket ${this.bucket}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Upload a file to S3 storage
   */
  async upload(
    file: File | Buffer | ReadableStream,
    filePath: string,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<StorageResult> {
    try {
      let body: Buffer | ReadableStream | Blob;
      let contentLength: number | undefined;

      if (file instanceof Buffer) {
        body = file;
        contentLength = file.length;
      } else if (file instanceof ReadableStream) {
        body = file;
        // Content length unknown for streams
      } else {
        // File object (browser)
        body = file;
        contentLength = (file as File).size;
      }

      const startTime = Date.now();
      let uploadedSize = 0;

      // Use multipart upload for large files or streams
      const upload = new Upload({
        client: this.client,
        params: {
          Bucket: this.bucket,
          Key: filePath,
          Body: body,
          ContentLength: contentLength,
        },
      });

      // Track progress
      upload.on('httpUploadProgress', (progress) => {
        if (onProgress && progress.loaded && progress.total) {
          uploadedSize = progress.loaded;
          const elapsed = (Date.now() - startTime) / 1000;
          const speed = elapsed > 0 ? uploadedSize / elapsed : 0;
          const remaining = progress.total - uploadedSize;
          const eta = speed > 0 ? remaining / speed : 0;

          onProgress({
            loaded: uploadedSize,
            total: progress.total,
            percentage: (uploadedSize / progress.total) * 100,
            speed,
            estimatedTimeRemaining: eta,
          });
        }
      });

      await upload.done();

      // Get object metadata
      const headResult = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: filePath,
        })
      );

      return {
        path: filePath,
        size: headResult.ContentLength || uploadedSize,
        etag: headResult.ETag?.replace(/"/g, ''),
        lastModified: headResult.LastModified,
      };
    } catch (error) {
      throw new Error(
        `Failed to upload file to S3 at ${filePath}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Upload a chunk of a file (for chunked uploads).
   *
   * Streams the chunk straight into S3 when its byte length is known
   * (options.contentLength), so the server→S3 transfer overlaps the
   * client→server one instead of buffering the whole chunk in memory first.
   *
   * Single-chunk files skip the multipart API entirely (one PutObject instead
   * of Create + UploadPart + Complete + Head). Multi-chunk files use multipart
   * with NO server-side state required: the upload id is echoed by the client
   * (or rediscovered via ListMultipartUploads), and part ETags are read back
   * with ListParts at finalize — so chunks may arrive in parallel, on any
   * instance, across restarts.
   */
  async uploadChunk(
    chunk: ReadableStream,
    filePath: string,
    options: ChunkUploadOptions
  ): Promise<ChunkUploadResult> {
    const { chunkIndex, totalChunks, isFirstChunk, isLastChunk } = options;
    try {
      // Stream when the length is known; S3 requires ContentLength up front,
      // so an unknown-length chunk (a proxy stripped content-length and the
      // client sent no x-chunk-size) falls back to full buffering.
      let body: Readable | Buffer;
      let contentLength: number;
      if (options.contentLength !== undefined) {
        body = Readable.fromWeb(chunk as unknown as WebReadableStream);
        contentLength = options.contentLength;
      } else {
        body = await bufferStream(chunk);
        contentLength = body.length;
      }

      // Fast path: the whole file fits in one chunk — a single PutObject.
      // S3 enforces that the body matches ContentLength, so no verify read
      // is needed afterwards.
      if (totalChunks === 1) {
        if (
          options.expectedTotalSize !== undefined &&
          options.expectedTotalSize !== contentLength
        ) {
          throw new Error(
            `chunk is ${contentLength} bytes but the file was declared as ` +
              `${options.expectedTotalSize} bytes`
          );
        }
        const putResult = await this.client.send(
          new PutObjectCommand({
            Bucket: this.bucket,
            Key: filePath,
            Body: body,
            ContentLength: contentLength,
          })
        );
        return {
          result: {
            path: filePath,
            size: contentLength,
            etag: putResult.ETag?.replace(/"/g, ''),
          },
        };
      }

      const now = Date.now();
      pruneStaleMultipartUploads(now);

      let uploadId: string;
      if (isFirstChunk) {
        // A retried first chunk (or a crashed earlier attempt) would orphan
        // the prior multipart upload; abort anything dangling for this key so
        // the store doesn't accumulate incomplete uploads.
        await this.abortDanglingUploads(filePath);

        const createResult = await this.client.send(
          new CreateMultipartUploadCommand({
            Bucket: this.bucket,
            Key: filePath,
          })
        );
        if (!createResult.UploadId) {
          throw new Error('Failed to create multipart upload');
        }
        uploadId = createResult.UploadId;
      } else {
        // Client echo → local cache → rediscover from the store itself.
        uploadId =
          options.multipartUploadId ??
          multipartUploads.get(filePath)?.uploadId ??
          (await this.discoverMultipartUploadId(filePath));
      }
      multipartUploads.set(filePath, { uploadId, updatedAt: now });

      // Upload this part (S3 part numbers are 1-based). A retried chunk
      // re-uploads the same part number, which S3 treats as a replace, so
      // retries are naturally idempotent.
      const partNumber = chunkIndex + 1;
      const uploadPartResult = await this.client.send(
        new UploadPartCommand({
          Bucket: this.bucket,
          Key: filePath,
          UploadId: uploadId,
          PartNumber: partNumber,
          Body: body,
          ContentLength: contentLength,
        })
      );
      if (!uploadPartResult.ETag) {
        throw new Error(`Failed to upload part ${partNumber}`);
      }

      if (!isLastChunk) {
        return { multipartUploadId: uploadId };
      }

      // Finalize: read the uploaded parts back from S3 (authoritative no
      // matter which instance handled which chunk), check completeness,
      // complete, then verify the assembled size.
      const parts = await this.listUploadedParts(filePath, uploadId);
      if (parts.length !== totalChunks) {
        throw new Error(
          `expected ${totalChunks} uploaded parts but found ${parts.length} — ` +
            'a chunk is missing or still in flight'
        );
      }

      await this.client.send(
        new CompleteMultipartUploadCommand({
          Bucket: this.bucket,
          Key: filePath,
          UploadId: uploadId,
          MultipartUpload: { Parts: parts },
        })
      );
      multipartUploads.delete(filePath);

      const headResult = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: filePath,
        })
      );
      const size = headResult.ContentLength ?? 0;
      if (
        options.expectedTotalSize !== undefined &&
        size !== options.expectedTotalSize
      ) {
        throw new Error(
          `assembled file is ${size} bytes but ${options.expectedTotalSize} ` +
            'bytes were expected — upload is corrupt'
        );
      }

      return {
        multipartUploadId: uploadId,
        result: {
          path: filePath,
          size,
          etag: headResult.ETag?.replace(/"/g, ''),
          lastModified: headResult.LastModified,
        },
      };
    } catch (error) {
      // Deliberately do NOT abort/delete the multipart upload here: the client
      // retries a failed chunk (same chunkIndex), and that retry depends on
      // the multipart upload surviving. Abandoned uploads are aborted when a
      // first chunk for the same path is re-sent; orphaned server-side uploads
      // should be swept by a bucket lifecycle policy.
      throw new Error(
        `Failed to upload chunk ${chunkIndex + 1}/${totalChunks} to S3 at ${filePath}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Find the in-progress multipart upload id for a key directly from S3.
   * Fallback for chunks that arrive with no client-echoed id on an instance
   * that didn't create the upload (restart, second instance, old client).
   * Picks the most recently initiated when several exist.
   */
  private async discoverMultipartUploadId(filePath: string): Promise<string> {
    const response = await this.client.send(
      new ListMultipartUploadsCommand({
        Bucket: this.bucket,
        Prefix: filePath,
      })
    );
    const candidates = (response.Uploads ?? []).filter(
      (u) => u.Key === filePath && u.UploadId
    );
    if (candidates.length === 0) {
      throw new Error('Multipart upload not initialized');
    }
    candidates.sort(
      (a, b) => (a.Initiated?.getTime() ?? 0) - (b.Initiated?.getTime() ?? 0)
    );
    return candidates[candidates.length - 1].UploadId as string;
  }

  /**
   * Abort every in-progress multipart upload for a key (used before starting
   * a fresh one so retried/crashed attempts don't accumulate).
   */
  private async abortDanglingUploads(filePath: string): Promise<void> {
    let uploadIds: string[] = [];
    try {
      const response = await this.client.send(
        new ListMultipartUploadsCommand({
          Bucket: this.bucket,
          Prefix: filePath,
        })
      );
      uploadIds = (response.Uploads ?? [])
        .filter((u) => u.Key === filePath && u.UploadId)
        .map((u) => u.UploadId as string);
    } catch (listError) {
      // Best-effort: some S3-compatible stores restrict this listing; a
      // dangling upload is only debris for the lifecycle policy to sweep.
      console.error('Failed to list dangling multipart uploads:', listError);
      return;
    }
    for (const uploadId of uploadIds) {
      await this.abortMultipartUpload(filePath, uploadId);
    }
  }

  /**
   * Read back all uploaded parts for a multipart upload, paginating as needed,
   * sorted by part number — the shape CompleteMultipartUpload expects.
   */
  private async listUploadedParts(
    filePath: string,
    uploadId: string
  ): Promise<Array<{ PartNumber: number; ETag: string }>> {
    const parts: Array<{ PartNumber: number; ETag: string }> = [];
    let marker: string | undefined;
    do {
      const response = await this.client.send(
        new ListPartsCommand({
          Bucket: this.bucket,
          Key: filePath,
          UploadId: uploadId,
          PartNumberMarker: marker,
        })
      );
      for (const part of response.Parts ?? []) {
        if (part.PartNumber !== undefined && part.ETag) {
          parts.push({ PartNumber: part.PartNumber, ETag: part.ETag });
        }
      }
      marker = response.IsTruncated ? response.NextPartNumberMarker : undefined;
    } while (marker);
    parts.sort((a, b) => a.PartNumber - b.PartNumber);
    return parts;
  }

  /**
   * Abort an in-progress multipart upload and drop its tracked state.
   */
  private async abortMultipartUpload(
    filePath: string,
    uploadId: string
  ): Promise<void> {
    try {
      await this.client.send(
        new AbortMultipartUploadCommand({
          Bucket: this.bucket,
          Key: filePath,
          UploadId: uploadId,
        })
      );
    } catch (abortError) {
      console.error('Failed to abort multipart upload:', abortError);
    }
    multipartUploads.delete(filePath);
  }

  /**
   * Download a file from S3 storage
   */
  async download(filePath: string): Promise<ReadableStream> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: filePath,
        })
      );

      if (!response.Body) {
        throw new Error('No body in S3 response');
      }

      // Convert AWS SDK stream to Web ReadableStream. The SDK types Body as a
      // union (Node Readable | web ReadableStream | Blob); in this runtime it is
      // always one of the async-iterable stream forms.
      const body = response.Body as
        | ReadableStream
        | AsyncIterable<Uint8Array | ArrayBuffer>;

      if (body instanceof ReadableStream) {
        return body;
      }

      // Handle Node.js stream
      return new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of body) {
              controller.enqueue(
                chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)
              );
            }
            controller.close();
          } catch (error) {
            controller.error(error);
          }
        },
      });
    } catch (error) {
      throw new Error(
        `Failed to download file from S3 at ${filePath}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Delete a file from S3 storage
   */
  async delete(filePath: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: filePath,
        })
      );
    } catch (error) {
      throw new Error(
        `Failed to delete file from S3 at ${filePath}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Move/rename an object within the bucket, overwriting the destination.
   * S3 has no native move, so this is a server-side CopyObject (no bytes
   * transit this process) followed by deleting the source. CopyObject atomically
   * replaces the destination key, so the destination is never left half-written.
   */
  async move(fromPath: string, toPath: string): Promise<void> {
    try {
      await this.client.send(
        new CopyObjectCommand({
          Bucket: this.bucket,
          // CopySource must include the bucket and be URL-encoded.
          CopySource: encodeURI(`${this.bucket}/${fromPath}`),
          Key: toPath,
        })
      );
    } catch (error) {
      throw new Error(
        `Failed to copy S3 object from ${fromPath} to ${toPath}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    // Best-effort cleanup of the source; the copy already succeeded, so a
    // failed delete only leaves a stray temp object (swept by lifecycle policy).
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: fromPath,
        })
      );
    } catch (error) {
      console.error(
        `Failed to delete source object ${fromPath} after move to ${toPath}:`,
        error
      );
    }
  }

  /**
   * Check if a file exists in S3 storage
   */
  async exists(filePath: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: filePath,
        })
      );
      return true;
    } catch (error) {
      const httpStatus =
        typeof error === 'object' && error !== null && '$metadata' in error
          ? (error as { $metadata?: { httpStatusCode?: number } }).$metadata
              ?.httpStatusCode
          : undefined;
      if (
        (error instanceof Error && error.name === 'NotFound') ||
        httpStatus === 404
      ) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Get a signed URL to access the file
   */
  async getUrl(filePath: string, expirySeconds = 3600): Promise<string> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: filePath,
      });

      const url = await getSignedUrl(this.client, command, {
        expiresIn: expirySeconds,
      });

      return url;
    } catch (error) {
      throw new Error(
        `Failed to generate signed URL for ${filePath}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * List files in S3 storage with a given prefix
   */
  async listFiles(prefix: string): Promise<StorageFile[]> {
    const files: StorageFile[] = [];

    try {
      let continuationToken: string | undefined;

      do {
        const response = await this.client.send(
          new ListObjectsV2Command({
            Bucket: this.bucket,
            Prefix: prefix,
            ContinuationToken: continuationToken,
          })
        );

        if (response.Contents) {
          for (const object of response.Contents) {
            if (object.Key) {
              files.push({
                key: object.Key,
                size: object.Size || 0,
                etag: object.ETag?.replace(/"/g, '') || '',
                lastModified: object.LastModified || new Date(),
              });
            }
          }
        }

        continuationToken = response.NextContinuationToken;
      } while (continuationToken);

      return files;
    } catch (error) {
      throw new Error(
        `Failed to list files in S3 with prefix ${prefix}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Get a presigned URL for direct browser uploads
   */
  async getPresignedUploadUrl(
    filePath: string,
    contentType: string,
    maxSize: number,
    expirySeconds = 3600
  ): Promise<PresignedUrl> {
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: filePath,
        ContentType: contentType,
      });

      const url = await getSignedUrl(this.client, command, {
        expiresIn: expirySeconds,
      });

      const expiresAt = new Date(Date.now() + expirySeconds * 1000);

      return {
        url,
        expiresAt,
        fields: {
          'Content-Type': contentType,
          'x-amz-content-length-range': `0,${maxSize}`,
        },
      };
    } catch (error) {
      throw new Error(
        `Failed to generate presigned upload URL for ${filePath}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}
