import { ProcessingProvider } from '@project/shared';

/**
 * Extract processor name from processor version string
 *
 * @param processorVersion - Processor version string (e.g., "label-detection:1.0.0")
 * @returns Processor name (e.g., "label-detection")
 */
function getProcessorName(processorVersion: string): string {
  return processorVersion.split(':')[0];
}

/**
 * Generate storage path for cached label data
 *
 * @param mediaId - Media record ID
 * @param version - Data version number
 * @param provider - Processing provider (e.g., google_video_intelligence, google_speech)
 * @param processorVersion - Processor version string (e.g., "label-detection:1.0.0")
 * @returns Storage path in format: labels/{mediaId}/v{version}/{processor}_{provider}.json
 *
 * @example
 * getLabelCachePath('abc123', 1, ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE, 'label-detection:1.0.0')
 * // Returns: 'labels/abc123/v1/label-detection_google_video_intelligence.json'
 */
export function getLabelCachePath(
  workspaceId: string,
  mediaId: string,
  version: number,
  provider: ProcessingProvider,
  processorVersion: string
): string {
  const processorName = getProcessorName(processorVersion);
  return `labels/${workspaceId}/${mediaId}/v${version}/${processorName}_${provider}.json`;
}
