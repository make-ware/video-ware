import { createHash } from 'crypto';
import {
  RecommendationStrategy,
  LabelType,
  RecommendationTargetMode,
} from '../enums';

/**
 * Input for generating a media recommendation query hash
 */
export interface MediaQueryHashInput {
  workspaceId: string;
  mediaId: string;
  mediaVersion: number;
  strategies: RecommendationStrategy[];
  filterParams?: {
    labelTypes?: LabelType[];
    minConfidence?: number;
    durationRange?: { min: number; max: number };
  };
}

/**
 * Input for generating a timeline recommendation query hash
 */
export interface TimelineQueryHashInput {
  workspaceId: string;
  timelineId: string;
  mediaVersion: number;
  seedClipId?: string;
  targetMode: RecommendationTargetMode;
  strategies: RecommendationStrategy[];
  searchParams?: {
    labelTypes?: LabelType[];
    minConfidence?: number;
    durationRange?: { min: number; max: number };
    timeWindow?: number;
  };
}

/**
 * Recursively normalizes an object by sorting all keys at every level.
 * This ensures deterministic JSON serialization regardless of key insertion order.
 */
function normalizeForHash(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => normalizeForHash(item));
  }

  if (typeof obj === 'object') {
    const sortedEntries = Object.entries(obj)
      .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
      .map(([key, value]) => [key, normalizeForHash(value)]);

    return Object.fromEntries(sortedEntries);
  }

  return obj;
}

/**
 * Builds a deterministic hash for media recommendation queries.
 * Same inputs will always produce the same hash, enabling upsert behavior.
 *
 * @param input - The media query parameters
 * @returns A 32-character hex hash
 */
export function buildMediaQueryHash(input: MediaQueryHashInput): string {
  // Normalize nested objects by sorting all keys recursively
  const normalized = normalizeForHash(input);
  const serialized = JSON.stringify(normalized);

  // Generate SHA256 hash and take first 32 characters
  return createHash('sha256').update(serialized).digest('hex').slice(0, 32);
}

/**
 * Builds a deterministic hash for timeline recommendation queries.
 * Same inputs will always produce the same hash, enabling upsert behavior.
 *
 * @param input - The timeline query parameters
 * @returns A 32-character hex hash
 */
export function buildTimelineQueryHash(input: TimelineQueryHashInput): string {
  // Normalize nested objects by sorting all keys recursively
  const normalized = normalizeForHash(input);
  const serialized = JSON.stringify(normalized);

  // Generate SHA256 hash and take first 32 characters
  return createHash('sha256').update(serialized).digest('hex').slice(0, 32);
}
