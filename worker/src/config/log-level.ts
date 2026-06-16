import type { LogLevel } from '@nestjs/common';

/**
 * NestJS log levels ordered from most to least verbose. This matches NestJS's
 * own severity ordering (verbose < debug < log < warn < error < fatal): a level
 * is enabled when it is at or above the configured threshold.
 */
const NEST_LEVELS_BY_SEVERITY: readonly LogLevel[] = [
  'verbose',
  'debug',
  'log',
  'warn',
  'error',
  'fatal',
];

/**
 * Map our application-level LOG_LEVEL values onto the NestJS level that acts as
 * the verbosity threshold. Note NestJS has no "info" level — its equivalent is
 * "log".
 */
const THRESHOLD_BY_LOG_LEVEL: Record<string, LogLevel> = {
  verbose: 'verbose',
  debug: 'debug',
  info: 'log',
  warn: 'warn',
  error: 'error',
};

/** Threshold used when LOG_LEVEL is unset or unrecognized. */
const DEFAULT_THRESHOLD: LogLevel = 'log'; // i.e. "info"

/**
 * Resolve the explicit list of NestJS log levels to enable for a given
 * LOG_LEVEL value. Returns the threshold level plus everything more severe, so
 * `warn` yields `['warn', 'error', 'fatal']` and lower-priority levels
 * (debug/log) are suppressed. `fatal` is always included.
 *
 * NestJS only reads the logger configuration once, at `NestFactory.create`
 * time, before the ConfigService exists — so this reads the raw env value
 * rather than going through ConfigService.
 */
export function resolveNestLogLevels(
  rawLogLevel: string | undefined
): LogLevel[] {
  const normalized = (rawLogLevel ?? '').trim().toLowerCase();
  const threshold = THRESHOLD_BY_LOG_LEVEL[normalized] ?? DEFAULT_THRESHOLD;
  const startIndex = NEST_LEVELS_BY_SEVERITY.indexOf(threshold);
  return NEST_LEVELS_BY_SEVERITY.slice(startIndex);
}
