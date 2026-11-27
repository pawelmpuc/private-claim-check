import type { Estimate, EstimateItem, ItemKind } from './types';

export type GapKind = ItemKind;

export interface GapRow {
  kind: GapKind;
  /** Net amounts. Deductions are negative, so the rows add up to the totals. */
  insurer: number;
  garage: number;
  gap: number;
  insurerHours: number | null;
  garageHours: number | null;
  insurerRate: number | null;
  garageRate: number | null;
}

export interface Comparison {
  insurerNet: number;
  garageNet: number;
  /** Quote minus estimate. */
  gap: number;
  rows: GapRow[];
  /** Lines of the quote with no counterpart in the estimate. */
  extra: EstimateItem[];
}

const ORDER: GapKind[] = ['part', 'labour', 'paint', 'material', 'other', 'deduction'];
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const amountOf = (item: EstimateItem) => Math.abs(item.total ?? 0);

function sumKind(estimate: Estimate, kind: GapKind) {
  const items = estimate.items.filter((i) => i.kind === kind);
  const total = round2(items.reduce((s, i) => s + amountOf(i), 0));
  const timed = kind === 'labour' || kind === 'paint';
  const hours = timed && items.length > 0 && items.every((i) => i.hours != null) ? round2(items.reduce((s, i) => s + (i.hours ?? 0), 0)) : null;
  const rate = kind === 'labour' ? estimate.labourRate : kind === 'paint' ? estimate.paintRate : null;
  return { total: kind === 'deduction' && total !== 0 ? -total : total, hours, rate };
}

/** The first five letters of every word of four letters or more, without diacritics. */
function stems(text: string): Set<string> {
  const plain = text.toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[̀-ͯ]/g, '');
  return new Set((plain.match(/[a-z]{4,}/g) ?? []).map((w) => w.slice(0, 5)));
}

function alike(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) return false;
  let shared = 0;
  for (const s of a) if (b.has(s)) shared += 1;
  return shared / Math.min(a.size, b.size) > 0.5;
}

/**
 * Compares the insurer's estimate with a workshop quote for the same repair.
 * Amounts are compared by category; lines are matched by the words of their descriptions.
 */
export function compareQuote(insurer: Estimate, garage: Estimate): Comparison {
  const rows: GapRow[] = [];
  for (const kind of ORDER) {
    const a = sumKind(insurer, kind);
    const b = sumKind(garage, kind);
    if (a.total === 0 && b.total === 0) continue;
    rows.push({ kind, insurer: a.total, garage: b.total, gap: round2(b.total - a.total), insurerHours: a.hours, garageHours: b.hours, insurerRate: a.rate, garageRate: b.rate });
  }
  const insurerNet = round2(rows.reduce((s, r) => s + r.insurer, 0));
  const garageNet = round2(rows.reduce((s, r) => s + r.garage, 0));
  const known = insurer.items.filter((i) => i.kind !== 'deduction').map((i) => stems(i.desc));
  const extra = garage.items.filter((i) => {
    if (i.kind === 'deduction' || amountOf(i) === 0) return false;
    const mine = stems(i.desc);
    return mine.size > 0 && !known.some((k) => alike(mine, k));
  });
  return { insurerNet, garageNet, gap: round2(garageNet - insurerNet), rows, extra };
}
