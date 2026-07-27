import { describe, expect, it } from 'vitest';
import { entityWriteErrorMessage } from '@/hooks/use-entities';

/**
 * Entities carry UNIQUE (WorkspaceRef, kind, name). PocketBase reports the
 * collision as a 400 with per-field errors at `response.data`, which reads to
 * an operator as the opaque "Failed to create record."
 */
function uniqueCollision() {
  return Object.assign(new Error('Failed to create record.'), {
    status: 400,
    response: {
      code: 400,
      data: {
        name: {
          code: 'validation_not_unique',
          message: 'Value must be unique.',
        },
      },
    },
  });
}

describe('entityWriteErrorMessage', () => {
  it('explains a unique-index collision', () => {
    expect(entityWriteErrorMessage(uniqueCollision(), 'fallback')).toBe(
      'An entity with that name and kind already exists in this workspace.'
    );
  });

  it('passes through an ordinary Error message', () => {
    expect(entityWriteErrorMessage(new Error('boom'), 'fallback')).toBe('boom');
  });

  it('falls back for a non-Error throw', () => {
    expect(entityWriteErrorMessage('nope', 'fallback')).toBe('fallback');
    expect(entityWriteErrorMessage(null, 'fallback')).toBe('fallback');
    expect(entityWriteErrorMessage(undefined, 'fallback')).toBe('fallback');
  });

  it('does not claim a collision for other field errors', () => {
    const otherFieldError = Object.assign(new Error('Failed to update.'), {
      status: 400,
      response: { data: { description: { code: 'validation_max_length' } } },
    });
    expect(entityWriteErrorMessage(otherFieldError, 'fallback')).toBe(
      'Failed to update.'
    );
  });

  it('does not claim a collision for a non-uniqueness error on name', () => {
    const required = Object.assign(new Error('Failed to update.'), {
      status: 400,
      response: { data: { name: { code: 'validation_required' } } },
    });
    expect(entityWriteErrorMessage(required, 'fallback')).toBe(
      'Failed to update.'
    );
  });

  it('tolerates a 403 with no field errors', () => {
    const forbidden = Object.assign(new Error('Forbidden'), {
      status: 403,
      response: { code: 403, data: {} },
    });
    expect(entityWriteErrorMessage(forbidden, 'fallback')).toBe('Forbidden');
  });
});
