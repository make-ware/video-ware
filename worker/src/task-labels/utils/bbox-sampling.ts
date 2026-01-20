// Bounding box sampling utilities for selecting representative frames

export interface BoundingBox {
  timeOffset: number; // seconds
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Selects up to 10 representative bounding box samples from a larger set
 * Uses temporal distribution to ensure samples are spread across the time range
 *
 * @param frames - Array of bounding boxes with time offsets
 * @param maxSamples - Maximum number of samples to return (default: 10)
 * @returns Array of representative bounding box samples
 */
export function sampleBoundingBoxes(
  frames: BoundingBox[],
  maxSamples: number = 10
): BoundingBox[] {
  if (frames.length === 0) {
    return [];
  }

  // If we have fewer frames than max samples, return all
  if (frames.length <= maxSamples) {
    return [...frames];
  }

  // Sort frames by time offset to ensure temporal ordering
  const sortedFrames = [...frames].sort((a, b) => a.timeOffset - b.timeOffset);

  // Use uniform temporal distribution
  const samples: BoundingBox[] = [];
  const step = frames.length / maxSamples;

  for (let i = 0; i < maxSamples; i++) {
    const index = Math.floor(i * step);
    samples.push(sortedFrames[index]);
  }

  return samples;
}

/**
 * Alternative sampling strategy: select frames at specific time intervals
 *
 * @param frames - Array of bounding boxes with time offsets
 * @param startTime - Start time in seconds
 * @param endTime - End time in seconds
 * @param maxSamples - Maximum number of samples to return (default: 10)
 * @returns Array of representative bounding box samples
 */
export function sampleBoundingBoxesByTime(
  frames: BoundingBox[],
  startTime: number,
  endTime: number,
  maxSamples: number = 10
): BoundingBox[] {
  if (frames.length === 0) {
    return [];
  }

  // If we have fewer frames than max samples, return all
  if (frames.length <= maxSamples) {
    return [...frames];
  }

  const duration = endTime - startTime;
  const timeStep = duration / maxSamples;

  const samples: BoundingBox[] = [];

  for (let i = 0; i < maxSamples; i++) {
    const targetTime = startTime + i * timeStep;

    // Find the frame closest to the target time
    let closestFrame = frames[0];
    let minDiff = Math.abs(frames[0].timeOffset - targetTime);

    for (const frame of frames) {
      const diff = Math.abs(frame.timeOffset - targetTime);
      if (diff < minDiff) {
        minDiff = diff;
        closestFrame = frame;
      }
    }

    samples.push(closestFrame);
  }

  // Remove duplicates while preserving order
  const uniqueSamples: BoundingBox[] = [];
  const seenTimes = new Set<number>();

  for (const sample of samples) {
    if (!seenTimes.has(sample.timeOffset)) {
      seenTimes.add(sample.timeOffset);
      uniqueSamples.push(sample);
    }
  }

  return uniqueSamples;
}

/**
 * Validates that the number of samples does not exceed the maximum
 *
 * @param samples - Array of bounding box samples
 * @param maxSamples - Maximum allowed samples (default: 10)
 * @throws Error if samples exceed maximum
 */
export function validateSampleCount(
  samples: BoundingBox[],
  maxSamples: number = 10
): void {
  if (samples.length > maxSamples) {
    throw new Error(
      `Sample count (${samples.length}) exceeds maximum (${maxSamples})`
    );
  }
}
