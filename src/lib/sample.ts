import type { Estimate } from './types';

/** A made-up estimate for trying the app. The insurer, the car and the amounts are fictional. */
export function sampleEstimate(): Estimate {
  const rows: Array<[string, Estimate['items'][number]['kind'], number | null, number | null, number | null, number, Estimate['items'][number]['partQuality']]> = [
    ['Zderzak przedni / Front bumper cover', 'part', 1, null, 1240, 1240, 'alternative'],
    ['Reflektor lewy LED / Left LED headlamp', 'part', 1, null, 2890, 2890, 'oem'],
    ['Błotnik przedni lewy / Left front wing', 'part', 1, null, 760, 760, 'alternative'],
    ['Wahacz przedni lewy / Left front control arm', 'part', 1, null, 420, 420, 'alternative'],
    ['Wymiana zderzaka i reflektora / Replace bumper and headlamp', 'labour', null, 3.4, null, 323, 'unknown'],
    ['Wymiana błotnika i wahacza / Replace wing and control arm', 'labour', null, 4.1, null, 389.5, 'unknown'],
    ['Lakierowanie zderzaka i błotnika / Paint bumper and wing', 'paint', null, 5.2, null, 520, 'unknown'],
    ['Materiał lakierniczy / Paint materials', 'material', 1, null, 610, 610, 'unknown'],
    ['Amortyzacja części 30% / Parts depreciation 30%', 'deduction', null, null, null, 1593, 'unknown'],
    ['Rabat na materiał lakierniczy 20% / Paint material discount 20%', 'deduction', null, null, null, 122, 'unknown'],
  ];
  return {
    currency: 'PLN',
    labourRate: 95,
    paintRate: 100,
    statedTotal: 5437.5,
    items: rows.map(([desc, kind, qty, hours, unitPrice, total, partQuality], n) => ({
      id: `sample${n}`,
      desc,
      kind,
      qty,
      hours,
      unitPrice,
      total,
      partQuality,
    })),
  };
}
