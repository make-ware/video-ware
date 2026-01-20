import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
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
  S3StorageConfig,
} from './types';

/**
 * S3-compatible storage backend implementation
 * Supports AWS S3, MinIO, Backblaze B2, Cloudflare R2, etc.
 */
export class S3StorageBackend implements StorageBackend {
  readonly type = StorageBackendType.S3;
  private readonly client: S3Client;
  private readonly bucket: string;
  // Track multipart uploads by file path
  private readonly multipartUploads: Map<
    string,
    { uploadId: string; parts: Array<{ PartNumber: number; ETag: string }> }
  > = new Map();

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
   * Upload a chunk of a file (for chunked uploads)
   * Uses S3 multipart upload API
   */
  async uploadChunk(
    chunk: ReadableStream,
    filePath: string,
    chunkIndex: number,
    totalChunks: number,
    isFirstChunk: boolean,
    isLastChunk: boolean
  ): Promise<StorageResult | void> {
    try {
      // Convert ReadableStream to Buffer
      const reader = chunk.getReader();
      const chunks: Uint8Array[] = [];
      let totalLength = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        totalLength += value.length;
      }

      const buffer = Buffer.concat(chunks.map((c) => Buffer.from(c)));

      // Initialize multipart upload on first chunk
      if (isFirstChunk) {
        const createResult = await this.client.send(
          new CreateMultipartUploadCommand({
            Bucket: this.bucket,
            Key: filePath,
          })
        );

        if (!createResult.UploadId) {
          throw new Error('Failed to create multipart upload');
        }

        this.multipartUploads.set(filePath, {
          uploadId: createResult.UploadId,
          parts: [],
        });
      }

      const uploadData = this.multipartUploads.get(filePath);
      if (!uploadData) {
        throw new Error('Multipart upload not initialized');
      }

      // Upload this part (S3 part numbers are 1-based)
      const partNumber = chunkIndex + 1;
      const uploadPartResult = await this.client.send(
        new UploadPartCommand({
          Bucket: this.bucket,
          Key: filePath,
          UploadId: uploadData.uploadId,
          PartNumber: partNumber,
          Body: buffer,
        })
      );

      if (!uploadPartResult.ETag) {
        throw new Error(`Failed to upload part ${partNumber}`);
      }

      // Store part info
      uploadData.parts.push({
        PartNumber: partNumber,
        ETag: uploadPartResult.ETag,
      });

      // Complete multipart upload on last chunk
      if (isLastChunk) {
        // Sort parts by part number
        uploadData.parts.sort((a, b) => a.PartNumber - b.PartNumber);

        await this.client.send(
          new CompleteMultipartUploadCommand({
            Bucket: this.bucket,
            Key: filePath,
            UploadId: uploadData.uploadId,
            MultipartUpload: {
              Parts: uploadData.parts,
            },
          })
        );

        // Clean up tracking
        this.multipartUploads.delete(filePath);

        // Get object metadata
        const headResult = await this.client.send(
          new HeadObjectCommand({
            Bucket: this.bucket,
            Key: filePath,
          })
        );

        console.log(totalLength);

        return {
          path: filePath,
          size: headResult.ContentLength || 0,
          etag: headResult.ETag?.replace(/"/g, ''),
          lastModified: headResult.LastModified,
        };
      }
    } catch (error) {
      // Abort multipart upload on error
      const uploadData = this.multipartUploads.get(filePath);
      if (uploadData) {
        try {
          await this.client.send(
            new AbortMultipartUploadCommand({
              Bucket: this.bucket,
              Key: filePath,
              UploadId: uploadData.uploadId,
            })
          );
        } catch (abortError) {
          console.error('Failed to abort multipart upload:', abortError);
        }
        this.multipartUploads.delete(filePath);
      }

      throw new Error(
        `Failed to upload chunk ${chunkIndex + 1}/${totalChunks} to S3 at ${filePath}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
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

      // Convert AWS SDK stream to Web ReadableStream
      const body = response.Body as any;

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
    } catch (error: any) {
      if (
        error.name === 'NotFound' ||
        error.$metadata?.httpStatusCode === 404
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
