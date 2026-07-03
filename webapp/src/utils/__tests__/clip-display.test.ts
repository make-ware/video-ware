import { describe, it, expect } from 'vitest';
import { getClipDisplayLabel, getClipDescription } from '../clip-display';

describe('getClipDisplayLabel', () => {
  it('prefers the top-level label', () => {
    expect(
      getClipDisplayLabel({ label: 'My Clip', clipData: { label: 'legacy' } })
    ).toBe('My Clip');
  });

  it('trims the top-level label', () => {
    expect(getClipDisplayLabel({ label: '  My Clip  ' })).toBe('My Clip');
  });

  it('falls through an empty top-level label to legacy clipData.label', () => {
    expect(
      getClipDisplayLabel({ label: '', clipData: { label: 'legacy' } })
    ).toBe('legacy');
  });

  it('falls through a whitespace-only label to legacy clipData.label', () => {
    expect(
      getClipDisplayLabel({ label: '   ', clipData: { label: 'legacy' } })
    ).toBe('legacy');
  });

  it('ignores a non-string clipData.label', () => {
    expect(getClipDisplayLabel({ clipData: { label: 42 } })).toBe('Clip');
  });

  it('defaults to "Clip" when nothing is set', () => {
    expect(getClipDisplayLabel({})).toBe('Clip');
    expect(getClipDisplayLabel({ clipData: undefined })).toBe('Clip');
  });

  it('supports a custom fallback', () => {
    expect(getClipDisplayLabel({}, '')).toBe('');
    expect(getClipDisplayLabel({ label: 'x' }, '')).toBe('x');
  });
});

describe('getClipDescription', () => {
  it('returns the trimmed description', () => {
    expect(getClipDescription({ description: ' notes ' })).toBe('notes');
  });

  it('returns undefined for empty or missing descriptions', () => {
    expect(getClipDescription({ description: '' })).toBeUndefined();
    expect(getClipDescription({ description: '   ' })).toBeUndefined();
    expect(getClipDescription({})).toBeUndefined();
  });
});
