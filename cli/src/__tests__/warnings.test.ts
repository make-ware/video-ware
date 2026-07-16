import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  enforceStrict,
  noopMessage,
  noopNotice,
  nudgedWarning,
  printOpWarnings,
  shiftedOthersNotice,
} from '../lib/warnings.js';
import { warn } from '../lib/output.js';

describe('warn', () => {
  it('prints a ⚠-prefixed line to stderr', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warn('clips overlap');
    expect(spy).toHaveBeenCalledWith('⚠ clips overlap');
    spy.mockRestore();
  });
});

describe('printOpWarnings', () => {
  it('prints warning-level entries to stderr and skips notices', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = vi.spyOn(console, 'log').mockImplementation(() => {});

    printOpWarnings([
      nudgedWarning(3, 10, ['c1']),
      shiftedOthersNotice('shifted 2 clips right', ['a', 'b']),
      noopNotice('nothing to write', ['c1']),
    ]);

    expect(err).toHaveBeenCalledTimes(1);
    expect(err.mock.calls[0][0]).toMatch(/^⚠ requested 3\.00s/);
    // notices are the commands' detail lines, not printed here
    expect(out).not.toHaveBeenCalled();
    err.mockRestore();
    out.mockRestore();
  });

  it('prints nothing for an empty list', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    printOpWarnings([]);
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });
});

describe('enforceStrict', () => {
  afterEach(() => {
    process.exitCode = undefined;
  });

  it('sets exit code 1 for warning-level entries when strict', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    enforceStrict([nudgedWarning(3, 10, ['c1'])], true);
    expect(process.exitCode).toBe(1);
    err.mockRestore();
  });

  it('ignores notices even when strict', () => {
    enforceStrict([noopNotice('nothing to write', ['c1'])], true);
    expect(process.exitCode).toBeUndefined();
  });

  it('does nothing without the strict flag', () => {
    enforceStrict([nudgedWarning(3, 10, ['c1'])], false);
    expect(process.exitCode).toBeUndefined();
  });
});

describe('noopMessage', () => {
  it('returns the noop entry message when present', () => {
    expect(noopMessage([noopNotice('already there', ['c1'])])).toBe(
      'already there'
    );
    expect(noopMessage([nudgedWarning(3, 10, ['c1'])])).toBeUndefined();
  });
});
