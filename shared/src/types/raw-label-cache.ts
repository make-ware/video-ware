// Raw label cache types for StorageBackend storage
import { ProcessingProvider } from '../enums';

export interface RawLabelCacheMetadata {
  mediaId: string;
  version: number;
  provider: ProcessingProvider;
  processor: string;
  createdAt: string; // ISO timestamp
  features: string[]; // e.g., ['LABEL_DETECTION', 'OBJECT_TRACKING']
}

export interface RawLabelCacheFile {
  metadata: RawLabelCacheMetadata;
  response: unknown; // Full provider API response
}
