import { parseSummary } from './summary';
import type { Estimate, EstimateItem, ItemKind, PartQuality } from './types';

const KINDS: ItemKind[] = ['part', 'labour', 'paint', 'material', 'deduction', 'other'];
const QUALITIES: PartQuality[] = ['oem', 'alternative', 'used', 'unknown'];

/** Prompt for the cloud model, which answers in JSON mode. */
export const READ_PROMPT = `You read a car repair cost estimate issued by an insurance company. The document can be in any language.
Return JSON only.

Fields:
- currency: ISO code of the currency used, for example PLN, EUR, GBP, USD.
- labourRate: hourly rate for body or mechanical work, as printed. null if not printed.
- paintRate: hourly rate for paint work, as printed. null if not printed.
- statedTotal: the total repair cost before VAT if the document shows one, otherwise the main total. null if not visible.
- items: one entry for every priced line of the estimate. Leave out section headings and leave out total, subtotal and VAT summary rows.

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

const SUMMARY_ROW = /\b(razem|suma|og[oó][lł]em|[lł][aą]cznie|total|subtotal|sum|gesamt|summe|netto|brutto|vat)\b/i;

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
    .filter((it) => it.desc.length > 0)
    // Section headings come back as lines without any number.
    .filter((it) => !(it.kind === 'other' && it.total == null && it.unitPrice == null && it.hours == null))
    // Total and subtotal rows would be counted twice.
    .filter((it) => !(it.kind === 'other' && SUMMARY_ROW.test(it.desc)));
  const currency = String(r.currency ?? '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
  // Estimating systems print hours on a labour line and the money only in the totals.
  const rates = { labour: num(r.labourRate), paint: num(r.paintRate) };
  for (const it of items) {
    const rate = it.kind === 'labour' ? rates.labour : it.kind === 'paint' ? rates.paint : null;
    if (it.total == null && it.unitPrice == null && it.hours != null && rate != null) it.total = Math.round(it.hours * rate * 100) / 100;
  }
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
    details: pages.some((p) => p.details) ? pages.flatMap((p) => p.details ?? []) : undefined,
  };
}

/**
 * Prompt for the on-device model. A small model copies a table far more reliably
 * than it restructures one, so it is only asked to transcribe. Sorting the rows into
 * parts, labour and deductions is done by parseTranscription below.
 */
export const TRANSCRIBE_PROMPT =
  'Transcribe the table in this image of a car repair cost estimate. Write one line per table row, with the cells separated by " | ", exactly as printed and in the original language. Write section headings on their own line. Include the total row. Copy every number exactly. Do not translate. Do not explain.';

export const TRANSCRIBE_TEXT_PROMPT =
  'Below is the text of a car repair cost estimate. Rewrite its priced lines as a table: one line per row, with the cells separated by " | ", in the original language. Keep section headings on their own line. Include the total row. Copy every number exactly. Do not translate. Do not explain.';

/** Lower-case letters only, without diacritics, so that a misread "ROBOTCZINA" still matches. */
const letters = (text: string) =>
  text
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[^a-z]/g, '');

const SECTIONS: Array<[ItemKind, RegExp]> = [
  ['deduction', /potrac|potrce|deduct|abzug|pomniejsz|obnizk/],
  ['paint', /lakier|paint|lackier/],
  ['labour', /robo[ct]|robcz|labou?r|arbeit|blachar|mechani/],
  ['material', /material/],
  ['part', /czesc|zamienn|^parts?$|spareparts|ersatzteil/],
  ['other', /^additional|^otherwork|^sundr|^dodatkow|^pozostal|^inneprace|^zusatz/],
];
const DEDUCTION_WORDS = /amortyz|urealn|rabat|potrac|upust|discount|deprecia|betterment|rebate|abzug|deduct/;
const LABOUR_WORDS = /wymian|napraw|demont|montaz|replace|repair|remove|refit|ausbau|einbau|ersetzen/;
const QUALITY_CODE = /^(oem|oe|o|q|pj|pc|pt|p|zj|z)$/i;
const QUALITY_WORDS: Array<[PartQuality, RegExp]> = [
  ['used', /^(used|recycled|second[- ]?hand|green( part)?|u[zż]ywan[aey]?|gebraucht)$/i],
  ['alternative', /^(non[- ]?oem|non[- ]?genuine|aftermarket|pattern( part)?|alternative|equivalent|zamiennik|nachbau)$/i],
  ['oem', /^(original|genuine|oryginaln[aey]?|oryginal|original(teil)?)$/i],
];
/** Part quality named by a whole cell, as a code ("Q") or a word ("Non-OEM"). */
function qualityOf(cell: string): PartQuality | null {
  const c = cell.trim();
  if (QUALITY_CODE.test(c)) return /^(o|oe|oem)$/i.test(c) ? 'oem' : 'alternative';
  for (const [quality, re] of QUALITY_WORDS) if (re.test(c)) return quality;
  return null;
}
const NUMERIC_CELL = /^[-\u2212+]?\s*\d[\d\s\u00a0.,]*\s*(z[lł]|pln|eur|gbp|usd|€|£|\$)?$/i;
const PERCENT_CELL = /^[-\u2212+]?\s*\d[\d.,]*\s*%$/;

const sectionOf = (text: string): ItemKind | null => {
  const key = letters(text);
  if (!key || key.length > 28) return null;
  return SECTIONS.find(([, re]) => re.test(key))?.[0] ?? null;
};

interface Row {
  item: EstimateItem;
  /** The amount of the row, used to recognise rows that two overlapping tiles both contain. */
  signature: string;
  rate: number | null;
  /**
   * Another amount this row may really have. A printed "-1 593,00" is sometimes
   * copied as the two cells "-1" and "593,00"; the printed total decides which is right.
   */
  alt: number | null;
  /** Row number, amount and start of the description, when the row was printed with a number. */
  numbered: string | null;
}

const isText = (cell: string) => !NUMERIC_CELL.test(cell) && !PERCENT_CELL.test(cell) && qualityOf(cell) == null;

/**
 * The on-device model sometimes writes a whole tile as one line. A line with more cells
 * than one row can hold is cut back into rows: at a row number followed by a description,
 * or at a description that follows an amount.
 */
function splitLongLine(line: string): string[] {
  const cells = line.split('|').map((c) => c.trim()).filter((c) => c !== '' && !/^:?-+:?$/.test(c));
  if (cells.length <= 8) return [line];
  const rows: string[][] = [[]];
  let numberAt = -1;
  for (let i = 0; i < cells.length; i += 1) {
    const cell = cells[i];
    const current = rows[rows.length - 1];
    const rowNumber = /^\d{1,3}\.?$/.test(cell) && i + 1 < cells.length && isText(cells[i + 1]);
    const afterAmount = i > 0 && isText(cell) && NUMERIC_CELL.test(cells[i - 1]) && numberAt !== i - 1;
    if ((rowNumber || afterAmount) && current.length > 0) rows.push([]);
    if (rowNumber) numberAt = i;
    rows[rows.length - 1].push(cell);
  }
  return rows.map((row) => {
    // Padding the model adds at the end of a row, such as "| 0 | | 0 |".
    while (row.length > 3 && /^0$/.test(row[row.length - 1])) row.pop();
    return row.join(' | ');
  });
}

function parseRows(text: string, state: { section: ItemKind | null; total: number | null; currency: string | null }): Row[] {
  const rows: Row[] = [];
  const currency = text.match(/\b(PLN|EUR|GBP|USD|CHF|CZK)\b|z[lł]\b|€|£|\$/i)?.[0];
  if (currency && !state.currency) {
    const c = currency.toUpperCase();
    state.currency = c === '€' ? 'EUR' : c === '£' ? 'GBP' : c === '$' ? 'USD' : /^Z/.test(c) ? 'PLN' : c;
  }
  for (const rawLine of text.split(/\r?\n/).flatMap(splitLongLine)) {
    const line = rawLine.replace(/\*\*|`/g, '').replace(/^\s*[-*>]\s+/, '').trim();
    if (!line) continue;
    let cells = line.split('|').map((c) => c.trim()).filter((c) => c !== '' && !/^:?-+:?$/.test(c));
    if (cells.length === 0) continue;

    const numericAt = cells.map((c) => NUMERIC_CELL.test(c));
    if (!numericAt.some(Boolean)) {
      const cur = line.match(/^CURRENCY\s*:\s*([A-Za-z]{3})\b/i);
      if (cur) state.currency = cur[1].toUpperCase();
      const heading = sectionOf(cells[0]);
      if (heading) state.section = heading;
      // A short heading in capitals that names no known section still ends the previous one.
      else if (cells.length === 1 && cells[0].split(/\s+/).length <= 3 && cells[0] === cells[0].toUpperCase() && /\p{Lu}{3}/u.test(cells[0])) state.section = null;
      continue;
    }
    // A leading row number such as "3 | Błotnik | ...".
    // "Parts | 1 | Front bumper | ...": the section name written in front of a numbered row.
    if (cells.length > 3 && cells[0].split(/\s+/).length <= 2 && /^\d{1,3}\.?$/.test(cells[1]) && !NUMERIC_CELL.test(cells[2])) {
      const lead = sectionOf(cells[0]);
      if (lead) {
        state.section = lead;
        cells = cells.slice(1);
      }
    }
    let rowNo: string | null = null;
    if (cells.length > 2 && /^\d{1,3}\.?$/.test(cells[0]) && !NUMERIC_CELL.test(cells[1])) {
      rowNo = cells[0].replace('.', '');
      cells = cells.slice(1);
    }

    const texts = cells.filter((c) => !NUMERIC_CELL.test(c) && !PERCENT_CELL.test(c) && qualityOf(c) == null);
    // Some transcriptions put the section name in front of a row, or in place of its description.
    let rowSection: ItemKind | null = null;
    if (texts.length > 0 && texts[0].split(/\s+/).length <= 2) {
      rowSection = sectionOf(texts[0]);
      if (rowSection) {
        state.section = rowSection;
        if (texts.length > 1) texts.shift();
      }
    }
    const desc = texts.join(' ').trim() || '?';
    const numbers = cells.filter((c) => NUMERIC_CELL.test(c));
    const values = numbers.map((c) => parseNumber(c)).filter((n): n is number => n != null);
    if (values.length === 0) continue;
    const last = numbers[numbers.length - 1];
    const amount = Math.abs(values[values.length - 1]);
    const negative = /^[-\u2212]/.test(last);
    if (amount === 0) continue;

    if (SUMMARY_ROW.test(desc)) {
      state.total = amount;
      continue;
    }

    const key = letters(desc);
    const quality = cells.map(qualityOf).find((q) => q != null) ?? null;
    const section = rowSection ?? state.section;
    let kind: ItemKind;
    if (negative || DEDUCTION_WORDS.test(key)) kind = 'deduction';
    else if (/material/.test(key)) kind = 'material';
    else if (section && section !== 'deduction') kind = section;
    else if (quality) kind = 'part';
    else if (/lakier|paint/.test(key)) kind = 'paint';
    else if (LABOUR_WORDS.test(key)) kind = 'labour';
    else kind = 'other';

    let hours: number | null = null;
    let rate: number | null = null;
    if (kind === 'labour' || kind === 'paint') {
      const [a, b] = values;
      if (values.length >= 3 && Math.abs(a * b - amount) <= Math.max(0.5, amount * 0.01)) {
        hours = a;
        rate = b;
      } else if (values.length >= 3 && b >= 10 && amount / b >= 0.1 && amount / b <= 100) {
        // The model sometimes copies the row number into the hours column.
        // The rate and the amount still say how many hours were priced.
        hours = Math.round((amount / b) * 100) / 100;
        rate = b;
      } else if (values.length === 2 && a < 100) {
        hours = a;
      }
    }

    const partQuality: PartQuality = kind === 'part' && quality ? quality : 'unknown';

    let alt: number | null = null;
    const lead = numbers.findIndex((c) => /^[-\u2212]\s*[1-9]$/.test(c));
    if (lead >= 0 && lead + 1 < numbers.length && /^\d{3}([.,]\d{1,2})?$/.test(numbers[lead + 1])) {
      alt = Math.abs(values[lead]) * 1000 + values[lead + 1];
      if (kind !== 'deduction') kind = 'deduction';
    }

    rows.push({
      item: { id: newId(), desc, kind, qty: null, hours, unitPrice: null, total: amount, partQuality },
      signature: String(amount),
      rate,
      alt,
      numbered: rowNo ? `${rowNo}|${amount}|${key.slice(0, 4)}` : null,
    });
  }
  return rows;
}

/** The most frequent value, used to pick the hourly rate out of the labour rows. */
function commonest(values: number[]): number | null {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: number | null = null;
  for (const [v, n] of counts) if (best == null || n > (counts.get(best) ?? 0)) best = v;
  return best;
}

/**
 * Turns the transcriptions of one page into an estimate. A page is read as several
 * overlapping tiles, so rows repeated at a seam are dropped.
 */
export function parseTranscription(tiles: string[], fallbackCurrency = 'EUR'): Estimate {
  const state = { section: null as ItemKind | null, total: null as number | null, currency: null as string | null };
  const rows: Row[] = [];
  const seen = new Set<string>();
  for (const tile of tiles) {
    // A numbered row that was already read is a repeat: from the overlap of two tiles,
    // or from the model writing the same row twice.
    const next = parseRows(tile, state).filter((r) => {
      if (!r.numbered) return true;
      if (seen.has(r.numbered)) return false;
      seen.add(r.numbered);
      return true;
    });
    let overlap = 0;
    for (let k = Math.min(8, rows.length, next.length); k > 0; k -= 1) {
      const tail = rows.slice(-k).map((r) => r.signature).join('~');
      const head = next.slice(0, k).map((r) => r.signature).join('~');
      if (tail === head) {
        overlap = k;
        break;
      }
    }
    rows.push(...next.slice(overlap));
  }
  settleByTotal(rows, state.total);
  const rateOf = (kind: ItemKind) => commonest(rows.filter((r) => r.item.kind === kind && r.rate != null).map((r) => r.rate as number));
  return {
    currency: state.currency ?? fallbackCurrency,
    labourRate: rateOf('labour'),
    paintRate: rateOf('paint'),
    statedTotal: state.total,
    items: rows.map((r) => r.item),
  };
}

/**
 * Uses the printed total as a checksum. Where a row has a second possible amount,
 * the combination that makes the lines add up to the total is taken. Rows that stay
 * undecided are marked for the user.
 */
function settleByTotal(rows: Row[], total: number | null): void {
  const doubtful = rows.filter((r) => r.alt != null).slice(0, 8);
  if (doubtful.length === 0) return;
  const net = () => rows.reduce((s, r) => s + (r.item.kind === 'deduction' ? -1 : 1) * (r.item.total ?? 0), 0);
  if (total != null) {
    if (Math.abs(net() - total) <= 0.5) return;
    for (let mask = 1; mask < 1 << doubtful.length; mask += 1) {
      const original = doubtful.map((r) => r.item.total);
      doubtful.forEach((r, i) => {
        if (mask & (1 << i)) r.item.total = r.alt;
      });
      if (Math.abs(net() - total) <= 0.5) return;
      doubtful.forEach((r, i) => {
        r.item.total = original[i];
      });
    }
  }
  for (const r of doubtful) r.item.check = true;
}

const TEXT_NUMBER = /[-\u2212]?\s?\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:[.,]\d{1,2})?|[-\u2212]?\s?\d+(?:[.,]\d{3})*(?:[.,]\d{1,2})?/g;
const CURRENCY_MARK = /\b(PLN|EUR|GBP|USD|CHF|CZK)\b|z[lł](?![a-ząćęłńóśźż])|€|£|\$/i;

/**
 * Structures pasted estimate text without a model. Text is already exact, so the
 * figures are taken as typed: a priced line is one that ends in an amount with two
 * decimals or a currency. Returns null when fewer than two priced lines are found,
 * and the caller then asks a model instead.
 */
export function parsePastedText(text: string, fallbackCurrency = 'EUR'): Estimate | null {
  const out: string[] = [];
  for (const rawLine of text.split(/\r?\n|;/)) {
    const line = rawLine.replace(/\t/g, '  ').trim();
    if (!line) continue;
    const found = [...line.matchAll(TEXT_NUMBER)];
    if (found.length === 0) {
      // A heading such as "Robocizna:" or a line of plain words.
      out.push(line.replace(/[:\s]+$/, ''));
      continue;
    }
    const last = found[found.length - 1];
    const after = line.slice(last.index + last[0].length);
    const before = line.slice(0, last.index);
    const priced = /[.,]\d{2}$/.test(last[0]) || CURRENCY_MARK.test(after) || /[€£$]\s*$/.test(before);
    if (!priced) continue;

    // "Części: Zderzak przedni ..." carries the section name in front of the first line.
    let head = line.slice(0, found[0].index).replace(/[\s:=x×*\-–]+$/i, '').trim();
    const colon = head.indexOf(':');
    if (colon > 0 && sectionOf(head.slice(0, colon)) && head.slice(colon + 1).trim()) {
      out.push(head.slice(0, colon).trim());
      head = head.slice(colon + 1).trim();
    }
    head = head.replace(/:$/, '').trim();
    const cells: string[] = [];
    const words = head.split(/\s+/);
    const tail = words[words.length - 1] ?? '';
    if (words.length > 1 && /^[A-Z]{1,3}$/.test(tail) && qualityOf(tail)) {
      cells.push(words.slice(0, -1).join(' '), tail);
    } else if (head) {
      cells.push(head);
    }
    for (const m of found) {
      const percent = line.slice(m.index + m[0].length).trimStart().startsWith('%');
      cells.push(m[0].replace(/\s+/g, ' ').trim() + (percent ? '%' : ''));
    }
    out.push(cells.join(' | '));
  }
  const mark = text.match(CURRENCY_MARK)?.[0];
  const estimate = parseTranscription([out.join('\n')], fallbackCurrency);
  if (mark) {
    const c = mark.toUpperCase();
    estimate.currency = c === '€' ? 'EUR' : c === '£' ? 'GBP' : c === '$' ? 'USD' : /^Z/.test(c) ? 'PLN' : c;
  }
  return estimate.items.length >= 2 ? estimate : null;
}

/**
 * Structures the text of a document, however it was obtained: from the text layer of a
 * PDF or from a transcription. The totals block is preferred when the document has one.
 */
export function parseDocumentText(pages: string[], fallbackCurrency = 'EUR'): { estimate: Estimate; taxRatePct: number | null; from: 'summary' | 'rows' } {
  const summary = parseSummary(pages.join('\n'), fallbackCurrency);
  if (summary) return { ...summary, from: 'summary' };
  return { estimate: parseTranscription(pages, fallbackCurrency), taxRatePct: null, from: 'rows' };
}
