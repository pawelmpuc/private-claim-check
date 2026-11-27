/** One run of text from a PDF page, with its position in page units. */
export interface TextRun {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Rebuilds the lines of a PDF page from its text runs. Runs on the same baseline form a
 * line; a wide gap between two runs is a column boundary and becomes " | ", so a table
 * row reads "Front bumper | 1 | 310.00 | 310.00".
 */
export function layoutLines(runs: TextRun[]): string[] {
  const live = runs.filter((r) => r.str.trim() !== '');
  if (live.length === 0) return [];
  const rows: TextRun[][] = [];
  // Top of the page first. PDF y grows upwards.
  for (const run of [...live].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows[rows.length - 1];
    const tolerance = Math.max(2, run.height * 0.45);
    if (row && Math.abs(row[0].y - run.y) <= tolerance) row.push(run);
    else rows.push([run]);
  }
  return rows.map((row) => {
    row.sort((a, b) => a.x - b.x);
    let line = '';
    let end = 0;
    row.forEach((run, n) => {
      if (n > 0) {
        const gap = run.x - end;
        const size = Math.max(run.height, row[n - 1].height, 6);
        line += gap > size * 0.9 ? ' | ' : gap > size * 0.12 ? ' ' : '';
      }
      line += run.str.trim();
      end = run.x + run.width;
    });
    return line.replace(/\s+/g, ' ').trim();
  });
}

/** A page counts as text when it holds enough characters to be more than a stamp on a scan. */
export const hasTextLayer = (lines: string[]) => lines.join('').replace(/[\s|]/g, '').length >= 80;
