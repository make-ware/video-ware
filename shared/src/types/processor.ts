import type { ProcessingProvider } from '../enums.js';
import type {
  ProbeOutput,
  ThumbnailConfig,
  SpriteConfig,
  TranscodeConfig,
  DetectLabelsConfig,
  DetectLabelsResult,
} from './task-contracts.js';

/**
 * Media processor interface
 * All media processing backends (FFmpeg, Google Cloud, etc.) must implement this interface
 */
export interface MediaProcessor {
  /** The processing provider this processor implements */
  readonly provider: ProcessingProvider;

  /** Version identifier for this processor (e.g., "7.0.1" for FFmpeg) */
  readonly version: string;

  /**
   * Probe a media file to extract metadata
   * @param fileRef - Reference to the file (PocketBase file path or File record ID)
   * @returns Metadata about the media file
   */
  probe(fileRef: string): Promise<ProbeOutput>;

  /**
   * Generate a thumbnail image from the media file
   * @param fileRef - Reference to the source media file
   * @param config - Thumbnail generation configuration
   * @param identifier - Optional identifier (upload ID or file ID) for temp file naming
   * @returns Path or URL to the generated thumbnail file
   */
  generateThumbnail(
    fileRef: string,
    config: ThumbnailConfig,
    identifier?: string
  ): Promise<string>;

  /**
   * Generate a sprite sheet from the media file
   * @param fileRef - Reference to the source media file
   * @param config - Sprite sheet generation configuration
   * @param identifier - Optional identifier (upload ID or file ID) for temp file naming
   * @returns Path or URL to the generated sprite sheet file
   */
  generateSprite(
    fileRef: string,
    config: SpriteConfig,
    identifier?: string
  ): Promise<string>;

  /**
   * Transcode the media file to a different format (optional)
   * @param fileRef - Reference to the source media file
   * @param config - Transcoding configuration
   * @param outputFileName - Optional deterministic output filename
   * @param identifier - Optional identifier (upload ID or file ID) for temp file naming
   * @returns Path or URL to the transcoded file
   */
  transcode?(
    fileRef: string,
    config: TranscodeConfig,
    outputFileName?: string,
    identifier?: string
  ): Promise<string>;

  /**
   * Detect labels and objects in the media file (optional)
   * @param fileRef - Reference to the source media file
   * @param config - Label detection configuration
   * @returns Detection results and metadata
   */
  detectLabels?(
    fileRef: string,
    config: DetectLabelsConfig
  ): Promise<DetectLabelsResult>;

  /**
   * Render a timeline to a single video file (optional)
   * @param payload - The full render task payload containing edit list and settings
   * @returns Reference to the generated output file (path or URI)
   */
  renderTimeline?(
    payload: import('./task-contracts.js').RenderTimelinePayload
  ): Promise<string>;
}
