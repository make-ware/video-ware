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

/**
 * Render an array of rows as a simple aligned text table.
 * `columns` maps a header to a cell accessor.
 */
export function table<T>(
  rows: T[],
  columns: { header: string; value: (row: T) => string }[]
): void {
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
