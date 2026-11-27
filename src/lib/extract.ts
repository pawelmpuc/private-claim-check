import type { Estimate, EstimateItem, ItemKind, PartQuality } from './types';

const KINDS: ItemKind[] = ['part', 'labour', 'paint', 'material', 'deduction', 'other'];
const QUALITIES: PartQuality[] = ['oem', 'alternative', 'used', 'unknown'];

/** JSON Schema given to the on-device model as a response constraint. */
export const ESTIMATE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    currency: { type: 'string' },
    labourRate: { type: ['number', 'null'] },
    paintRate: { type: ['number', 'null'] },
    statedTotal: { type: ['number', 'null'] },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          desc: { type: 'string' },
          kind: { type: 'string', enum: KINDS },
          qty: { type: ['number', 'null'] },
          hours: { type: ['number', 'null'] },
          unitPrice: { type: ['number', 'null'] },
          total: { type: ['number', 'null'] },
          partQuality: { type: 'string', enum: QUALITIES },
        },
        required: ['desc', 'kind', 'total', 'partQuality'],
        additionalProperties: false,
      },
    },
  },
  required: ['currency', 'items'],
  additionalProperties: false,
} as const;

export const READ_PROMPT = `You read a car repair cost estimate issued by an insurance company. The document can be in any language.
Return JSON only.

Fields:
- currency: ISO code of the currency used, for example PLN, EUR, GBP, USD.
- labourRate: hourly rate for body or mechanical work, as printed. null if not printed.
- paintRate: hourly rate for paint work, as printed. null if not printed.
- statedTotal: the total repair cost before VAT if the document shows one, otherwise the main total. null if not visible.
- items: one entry for every line of the estimate.

For each item:
- desc: the line text, copied in the original language.
- kind: "part" for a replaced part, "labour" for body or mechanical work, "paint" for paint work, "material" for paint and other materials, "deduction" for any line that lowers the payout (depreciation, wear, betterment, discount, rebate, "amortyzacja", "urealnienie", "rabat", "potrącenie"), otherwise "other".
- qty: quantity, or null.
- hours: labour time in hours for labour and paint lines, or null. Convert time units to hours if the document says how.
- unitPrice: price per unit, or null.
- total: line total as a positive number, or null if the line has none.
- partQuality: for parts only. "oem" for original manufacturer parts (quality codes O, OE, OEM). "alternative" for aftermarket or substitute parts (codes Q, P, PJ, PC, PT, Z, or words such as "zamiennik", "aftermarket", "alternative"). "used" for used parts. Otherwise "unknown".

Copy numbers exactly. Never invent a line or a number that is not in the document.`;

/** Parses "1 234,50", "1.234,50", "1,234.50" and plain numbers. */
export function parseNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  let s = v.replace(/[^\d,.-]/g, '');
  if (!/\d/.test(s)) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    const decimal = lastComma > lastDot ? ',' : '.';
    const thousands = decimal === ',' ? '.' : ',';
    s = s.split(thousands).join('').replace(decimal, '.');
  } else {
    const sep = lastComma >= 0 ? ',' : lastDot >= 0 ? '.' : '';
    if (sep) {
      const parts = s.split(sep);
      const grouped = parts.length > 2 || (parts[1].length === 3 && parts[0].replace('-', '') !== '0');
      s = grouped ? parts.join('') : parts.join('.');
    }
  }
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

const num = parseNumber;

let counter = 0;
export const newId = () => `i${Date.now().toString(36)}${(counter++).toString(36)}`;

export function emptyItem(): EstimateItem {
  return { id: newId(), desc: '', kind: 'part', qty: 1, hours: null, unitPrice: null, total: null, partQuality: 'unknown' };
}

/** Pulls the first JSON object out of a model reply, with or without a code fence. */
export function parseModelJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The model did not return JSON.');
  return JSON.parse(text.slice(start, end + 1));
}

export function normalizeEstimate(raw: unknown): Estimate {
  const r = (raw ?? {}) as Record<string, unknown>;
  const rawItems = Array.isArray(r.items) ? (r.items as Array<Record<string, unknown>>) : [];
  const items: EstimateItem[] = rawItems
    .map((it) => {
      const kind = KINDS.includes(it.kind as ItemKind) ? (it.kind as ItemKind) : 'other';
      const total = num(it.total);
      return {
        id: newId(),
        desc: String(it.desc ?? '').trim(),
        kind,
        qty: num(it.qty),
        hours: num(it.hours),
        unitPrice: num(it.unitPrice),
        total: total == null ? null : Math.abs(total),
        partQuality: kind === 'part' && QUALITIES.includes(it.partQuality as PartQuality) ? (it.partQuality as PartQuality) : 'unknown',
      } satisfies EstimateItem;
    })
    .filter((it) => it.desc.length > 0);
  const currency = String(r.currency ?? '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
  return {
    currency: currency.length === 3 ? currency : 'EUR',
    labourRate: num(r.labourRate),
    paintRate: num(r.paintRate),
    statedTotal: num(r.statedTotal),
    items,
  };
}

/** Joins the results of several pages into one estimate. */
export function mergeEstimates(pages: Estimate[]): Estimate {
  if (pages.length === 0) return { currency: 'EUR', labourRate: null, paintRate: null, statedTotal: null, items: [] };
  const firstWith = <K extends 'labourRate' | 'paintRate'>(key: K) => pages.find((p) => p[key] != null)?.[key] ?? null;
  const totals = pages.map((p) => p.statedTotal).filter((t): t is number => t != null);
  return {
    currency: pages.find((p) => p.items.length > 0)?.currency ?? pages[0].currency,
    labourRate: firstWith('labourRate'),
    paintRate: firstWith('paintRate'),
    // The grand total is normally the last total printed.
    statedTotal: totals.length > 0 ? totals[totals.length - 1] : null,
    items: pages.flatMap((p) => p.items),
  };
}
