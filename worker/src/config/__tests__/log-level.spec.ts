import { describe, it, expect } from 'vitest';
import { resolveNestLogLevels } from '../log-level';

describe('resolveNestLogLevels', () => {
  it('enables only warn and above for LOG_LEVEL=warn', () => {
    expect(resolveNestLogLevels('warn')).toEqual(['warn', 'error', 'fatal']);
  });

  it('maps info to NestJS "log" and suppresses debug', () => {
    const levels = resolveNestLogLevels('info');
    expect(levels).toEqual(['log', 'warn', 'error', 'fatal']);
    expect(levels).not.toContain('debug');
  });

  it('enables everything for LOG_LEVEL=debug', () => {
    expect(resolveNestLogLevels('debug')).toEqual([
      'debug',
      'log',
      'warn',
      'error',
      'fatal',
    ]);
  });

  it('enables all levels including verbose for LOG_LEVEL=verbose', () => {
    expect(resolveNestLogLevels('verbose')).toEqual([
      'verbose',
      'debug',
      'log',
      'warn',
      'error',
      'fatal',
    ]);
  });

  it('enables only error and fatal for LOG_LEVEL=error', () => {
    expect(resolveNestLogLevels('error')).toEqual(['error', 'fatal']);
  });

  it('always includes fatal at every threshold', () => {
    for (const level of ['verbose', 'debug', 'info', 'warn', 'error']) {
      expect(resolveNestLogLevels(level)).toContain('fatal');
    }
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(resolveNestLogLevels('  WARN ')).toEqual(['warn', 'error', 'fatal']);
  });

  it('defaults to info (log) when unset', () => {
    expect(resolveNestLogLevels(undefined)).toEqual([
      'log',
      'warn',
      'error',
      'fatal',
    ]);
  });

  it('defaults to info (log) for unrecognized values', () => {
    expect(resolveNestLogLevels('chatty')).toEqual([
      'log',
      'warn',
      'error',
      'fatal',
    ]);
  });
});
