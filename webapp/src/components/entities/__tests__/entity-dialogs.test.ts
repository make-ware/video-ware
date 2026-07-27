import { describe, expect, it } from 'vitest';
import {
  formatAliasInput,
  parseAliasInput,
} from '@/components/entities/entity-dialogs';

describe('parseAliasInput', () => {
  it('splits on commas and trims', () => {
    expect(parseAliasInput('Erik, Eric')).toEqual(['Erik', 'Eric']);
    expect(parseAliasInput('  Erik ,Eric  ')).toEqual(['Erik', 'Eric']);
  });

  it('drops empty segments', () => {
    expect(parseAliasInput('Erik,,Eric,')).toEqual(['Erik', 'Eric']);
    expect(parseAliasInput('')).toEqual([]);
    expect(parseAliasInput('   ')).toEqual([]);
    expect(parseAliasInput(',,,')).toEqual([]);
  });

  it('dedupes while preserving first-seen order', () => {
    expect(parseAliasInput('Erik, Eric, Erik')).toEqual(['Erik', 'Eric']);
  });
});

describe('formatAliasInput', () => {
  // aliases is a JSONField, so it reads back as `unknown` — anything that is
  // not an array of strings has to degrade to an empty field, not throw.
  it('guards every non-array shape', () => {
    expect(formatAliasInput(undefined)).toBe('');
    expect(formatAliasInput(null)).toBe('');
    expect(formatAliasInput('Erik')).toBe('');
    expect(formatAliasInput(42)).toBe('');
    expect(formatAliasInput({ a: 1 })).toBe('');
  });

  it('joins a string array', () => {
    expect(formatAliasInput([])).toBe('');
    expect(formatAliasInput(['Erik'])).toBe('Erik');
    expect(formatAliasInput(['Erik', 'Eric'])).toBe('Erik, Eric');
  });

  it('drops non-string members of a mixed array', () => {
    expect(formatAliasInput(['Erik', 1, null, 'Eric'])).toBe('Erik, Eric');
  });
});

describe('alias round-trip', () => {
  it('survives format → parse unchanged', () => {
    const aliases = ['Erik', 'Eric', 'E.'];
    expect(parseAliasInput(formatAliasInput(aliases))).toEqual(aliases);
  });

  it('normalises whitespace-only differences to the same list', () => {
    expect(parseAliasInput('Erik,Eric')).toEqual(parseAliasInput('Erik, Eric'));
  });
});
