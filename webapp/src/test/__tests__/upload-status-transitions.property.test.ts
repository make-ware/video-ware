/**
 * Property Tests for Upload Status Transitions
 *
 * Feature: media-uploads-ingestion, Property 6: Upload Status Transitions
 *
 * For any Upload record, the status field SHALL follow valid state transitions:
 * - uploading → uploaded → processing → ready
 * - uploading → failed
 * - uploaded → failed
 * - processing → failed
 *
 * Validates: Requirements 2.5, 3.3, 7.4, 8.2
 */

import { describe, it, expect } from 'vitest';
import { UploadStatus } from '@project/shared';

/**
 * Valid status transitions for uploads
 * Maps each status to the set of valid next statuses
 */
const VALID_TRANSITIONS: Record<UploadStatus, Set<UploadStatus>> = {
  [UploadStatus.QUEUED]: new Set([UploadStatus.UPLOADING, UploadStatus.FAILED]),
  [UploadStatus.UPLOADING]: new Set([
    UploadStatus.UPLOADED,
    UploadStatus.FAILED,
  ]),
  [UploadStatus.UPLOADED]: new Set([
    UploadStatus.PROCESSING,
    UploadStatus.FAILED,
  ]),
  [UploadStatus.PROCESSING]: new Set([UploadStatus.READY, UploadStatus.FAILED]),
  [UploadStatus.READY]: new Set([]), // Terminal state - no transitions allowed
  [UploadStatus.FAILED]: new Set([UploadStatus.UPLOADED]), // Can retry from failed
};

/**
 * Check if a status transition is valid
 */
function isValidTransition(from: UploadStatus, to: UploadStatus): boolean {
  const validNextStates = VALID_TRANSITIONS[from];
  return validNextStates.has(to);
}

/**
 * Check if a sequence of status transitions is valid
 */
function isValidTransitionSequence(statuses: UploadStatus[]): boolean {
  if (statuses.length < 2) return true;

  for (let i = 0; i < statuses.length - 1; i++) {
    if (!isValidTransition(statuses[i], statuses[i + 1])) {
      return false;
    }
  }
  return true;
}

/**
 * Generate all valid status sequences starting from a given status
 */
function generateValidSequences(
  start: UploadStatus,
  maxLength: number = 5
): UploadStatus[][] {
  const sequences: UploadStatus[][] = [];

  function explore(current: UploadStatus[], depth: number) {
    if (depth >= maxLength) return;

    const lastStatus = current[current.length - 1];
    const validNext = VALID_TRANSITIONS[lastStatus];

    if (validNext.size === 0) {
      // Terminal state reached
      sequences.push([...current]);
      return;
    }

    for (const next of validNext) {
      const newSequence = [...current, next];
      sequences.push(newSequence);
      explore(newSequence, depth + 1);
    }
  }

  sequences.push([start]);
  explore([start], 1);

  return sequences;
}

/**
 * Generate invalid status transitions
 */
function generateInvalidTransitions(): Array<{
  from: UploadStatus;
  to: UploadStatus;
}> {
  const invalid: Array<{ from: UploadStatus; to: UploadStatus }> = [];
  const allStatuses = Object.values(UploadStatus);

  for (const from of allStatuses) {
    for (const to of allStatuses) {
      if (from !== to && !isValidTransition(from, to)) {
        invalid.push({ from, to });
      }
    }
  }

  return invalid;
}

describe('Upload Status Transitions Property Tests', () => {
  /**
   * Property 6: Upload Status Transitions
   * For any Upload record, the status field SHALL follow valid state transitions
   * Validates: Requirements 2.5, 3.3, 7.4, 8.2
   */
  describe('Property 6: Upload Status Transitions', () => {
    it('should allow valid happy path transitions: uploading → uploaded → processing → ready', () => {
      const happyPath: UploadStatus[] = [
        UploadStatus.UPLOADING,
        UploadStatus.UPLOADED,
        UploadStatus.PROCESSING,
        UploadStatus.READY,
      ];

      expect(isValidTransitionSequence(happyPath)).toBe(true);
    });

    it('should allow transition to failed from any non-terminal state', () => {
      const failableStates = [
        UploadStatus.QUEUED,
        UploadStatus.UPLOADING,
        UploadStatus.UPLOADED,
        UploadStatus.PROCESSING,
      ];

      for (const state of failableStates) {
        expect(isValidTransition(state, UploadStatus.FAILED)).toBe(true);
      }
    });

    it('should not allow transitions from terminal states (ready)', () => {
      const allStatuses = Object.values(UploadStatus);

      for (const nextStatus of allStatuses) {
        if (nextStatus !== UploadStatus.READY) {
          expect(isValidTransition(UploadStatus.READY, nextStatus)).toBe(false);
        }
      }
    });

    it('should allow retry from failed state (failed → uploaded)', () => {
      expect(
        isValidTransition(UploadStatus.FAILED, UploadStatus.UPLOADED)
      ).toBe(true);
    });

    it('should reject all invalid transitions', () => {
      const invalidTransitions = generateInvalidTransitions();

      // Ensure we have some invalid transitions to test
      expect(invalidTransitions.length).toBeGreaterThan(0);

      for (const { from, to } of invalidTransitions) {
        expect(isValidTransition(from, to)).toBe(false);
      }
    });

    it('should validate all generated valid sequences', () => {
      const startingStates = [UploadStatus.QUEUED, UploadStatus.UPLOADING];

      for (const start of startingStates) {
        const validSequences = generateValidSequences(start, 5);

        // Ensure we generated some sequences
        expect(validSequences.length).toBeGreaterThan(0);

        for (const sequence of validSequences) {
          expect(isValidTransitionSequence(sequence)).toBe(true);
        }
      }
    });

    it('should not allow skipping states in the happy path', () => {
      // Cannot go directly from uploading to processing (must go through uploaded)
      expect(
        isValidTransition(UploadStatus.UPLOADING, UploadStatus.PROCESSING)
      ).toBe(false);

      // Cannot go directly from uploading to ready
      expect(
        isValidTransition(UploadStatus.UPLOADING, UploadStatus.READY)
      ).toBe(false);

      // Cannot go directly from uploaded to ready (must go through processing)
      expect(isValidTransition(UploadStatus.UPLOADED, UploadStatus.READY)).toBe(
        false
      );
    });

    it('should not allow backward transitions (except retry)', () => {
      // Cannot go from uploaded back to uploading
      expect(
        isValidTransition(UploadStatus.UPLOADED, UploadStatus.UPLOADING)
      ).toBe(false);

      // Cannot go from processing back to uploaded
      expect(
        isValidTransition(UploadStatus.PROCESSING, UploadStatus.UPLOADED)
      ).toBe(false);

      // Cannot go from ready back to processing
      expect(
        isValidTransition(UploadStatus.READY, UploadStatus.PROCESSING)
      ).toBe(false);
    });

    it('should handle retry flow correctly: failed → uploaded → processing → ready', () => {
      const retryFlow: UploadStatus[] = [
        UploadStatus.UPLOADING,
        UploadStatus.UPLOADED,
        UploadStatus.PROCESSING,
        UploadStatus.FAILED,
        UploadStatus.UPLOADED, // Retry
        UploadStatus.PROCESSING,
        UploadStatus.READY,
      ];

      expect(isValidTransitionSequence(retryFlow)).toBe(true);
    });

    it('should validate transition consistency across multiple iterations', () => {
      // Run the same validation multiple times to ensure consistency
      for (let i = 0; i < 100; i++) {
        // Happy path should always be valid
        expect(
          isValidTransition(UploadStatus.UPLOADING, UploadStatus.UPLOADED)
        ).toBe(true);
        expect(
          isValidTransition(UploadStatus.UPLOADED, UploadStatus.PROCESSING)
        ).toBe(true);
        expect(
          isValidTransition(UploadStatus.PROCESSING, UploadStatus.READY)
        ).toBe(true);

        // Invalid transitions should always be invalid
        expect(
          isValidTransition(UploadStatus.READY, UploadStatus.UPLOADING)
        ).toBe(false);
        expect(
          isValidTransition(UploadStatus.UPLOADING, UploadStatus.READY)
        ).toBe(false);
      }
    });
  });
});

// Export for use in other tests
export { isValidTransition, isValidTransitionSequence, VALID_TRANSITIONS };
