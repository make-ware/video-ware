/** Print an informational line to stdout. */
export function info(message: string): void {
  console.log(message);
}

/** Print a success line (✓ prefix). */
export function success(message: string): void {
  console.log(`✓ ${message}`);
}

/** Print an error line to stderr. */
export function error(message: string): void {
  console.error(`✗ ${message}`);
}

/** A table column: header plus a cell accessor. */
export type Column<T> = { header: string; value: (row: T) => string };

/**
 * Render an array of rows as a simple aligned text table.
 * `columns` maps a header to a cell accessor.
 */
export function table<T>(rows: T[], columns: Column<T>[]): void {
  if (rows.length === 0) {
    console.log('(none)');
    return;
  }

  const headers = columns.map((c) => c.header);
  const cells = rows.map((row) => columns.map((c) => c.value(row) ?? ''));

  const widths = headers.map((header, i) =>
    Math.max(header.length, ...cells.map((r) => r[i].length))
  );

  const formatRow = (values: string[]) =>
    values.map((v, i) => v.padEnd(widths[i])).join('  ');

  console.log(formatRow(headers));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of cells) {
    console.log(formatRow(row));
  }
}

export interface PrintListOptions {
  /** Emit machine-readable JSON instead of the concise table. */
  json?: boolean;
  /** Total matching records when the rows are one page of a larger result. */
  totalItems?: number;
  /** Extra command-specific hint appended to the concise footer. */
  hint?: string;
}

/**
 * Print a list result: concise table + `--json` hint footer by default, or
 * a `{ items, totalItems }` JSON document (nothing else on stdout) when
 * `json` is set.
 */
export function printList<T>(
  rows: T[],
  columns: Column<T>[],
  opts: PrintListOptions = {}
): void {
  const totalItems = opts.totalItems ?? rows.length;
  if (opts.json) {
    console.log(JSON.stringify({ items: rows, totalItems }, null, 2));
    return;
  }
  table(rows, columns);
  if (rows.length === 0) return;
  const shown =
    totalItems > rows.length
      ? `${rows.length} of ${totalItems} shown — `
      : totalItems === rows.length && rows.length > 1
        ? `${rows.length} shown — `
        : '';
  const hint = opts.hint ? `; ${opts.hint}` : '';
  console.log(`(${shown}add --json for full records${hint})`);
}

/**
 * Print a single record: concise summary lines by default, or the raw
 * record as JSON (nothing else on stdout) when `json` is set.
 */
export function printRecord(
  record: unknown,
  conciseLines: string[],
  json?: boolean
): void {
  if (json) {
    console.log(JSON.stringify(record, null, 2));
    return;
  }
  for (const line of conciseLines) {
    console.log(line);
  }
}

/** Truncate display text to `max` characters with an ellipsis. */
export function truncate(text: string, max = 60): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Format a duration in seconds as `m:ss` (or `h:mm:ss`). */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Exit the process after printing an error message. */
export function fail(message: string): never {
  error(message);
  process.exit(1);
}
