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
  // Body shops write "aim headlamps" for what a workshop bills as a calibration.
  const words = plain.replace(/\baim(ing)?\b/g, 'calibration');
  return new Set((words.match(/[a-z]{4,}/g) ?? []).map((w) => w.slice(0, 5)));
}

/** Words that say where a part sits or what kind of line it is, not what the work is. */
const GENERIC = new Set(
  'left right front rear lower upper outer inner assy assem lewy lewa lewe prawy prawa prawe przed tylny tylna repla repai remov insta refit overh blend paint refin labor labou mater suppl parts wymia napra lakie roboc monta demon czesc addit cover'.split(' '),
);

/**
 * A line of the quote counts as work the estimate leaves out when at least half of its
 * telling words appear nowhere in the estimate. "Headlamp calibration" against an estimate
 * that replaces a headlamp and never mentions calibration is such a line.
 */
function leftOut(line: Set<string>, estimateWords: Set<string>): boolean {
  const telling = [...line].filter((w) => !GENERIC.has(w));
  if (telling.length === 0) return false;
  const absent = telling.filter((w) => !estimateWords.has(w)).length;
  return absent / telling.length >= 0.5;
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
  const estimateWords = new Set([...insurer.items.filter((i) => i.kind !== 'deduction').map((i) => i.desc), ...(insurer.details ?? [])].flatMap((d) => [...stems(d)]));
  const extra = garage.items.filter((i) => i.kind !== 'deduction' && amountOf(i) > 0 && leftOut(stems(i.desc), estimateWords));
  return { insurerNet, garageNet, gap: round2(garageNet - insurerNet), rows, extra };
}
