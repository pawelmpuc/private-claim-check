import { parseNumber } from './extract';
import type { Estimate, EstimateItem, ItemKind } from './types';

/**
 * Reads the totals block that estimating systems print at the end of an estimate:
 * "ESTIMATE TOTALS" in CCC ONE, "KALKULACJA KOŃCOWA" in Audatex. Real estimates carry
 * separate columns for labour and paint hours on every line, so the line table is hard
 * to price row by row. The totals block states the same thing in a few rows: hours,
 * hourly rates, parts, deductions and the total.
 */

type Role = ItemKind | 'net' | 'gross' | 'tax' | 'excess';

const RULES: Array<[RegExp, Role]> = [
  [/^(parts|totalparts|partstotal|totalreplacementparts(amount)?|razemczescizamienne)$/, 'part'],
  [/^((body|mechanical|frame|structural|glass|electrical|diagnostic|total)?labou?r|razemrobocizna)$/, 'labour'],
  [/^(paintlabou?r|refinishlabou?r|refinish|kosztyrobocizny)$/, 'paint'],
  [/^(paintsupplies|paintmaterials?|paintandmaterials?|kosztymaterialu)$/, 'material'],
  [/^(miscellaneous|sublet|subletrepairs|towing|storage|(total)?additionalcosts?|shopsupplies|hazardouswaste)$/, 'other'],
  [/^(betterment|depreciation|(total)?adjustments?|discount|appearanceallowance|amortyzacja.*|potracenia?|urealnienie.*|rabat.*)$/, 'deduction'],
  [/^(subtotal|netcostofrepairs|kosztynaprawybezvat)$/, 'net'],
  [/^(grandtotal|totalcostofrepairs|grosstotal|estimatetotal|kosztynaprawyzvat)$/, 'gross'],
  [/^(salestax|tax|vat)$/, 'tax'],
  [/^(deductible|excess|udzialwlasny)$/, 'excess'],
];

const AMOUNT = /^[-−(]?\s*[$£€]?\s*\d[\d\s .,]*[.,]\d{2}\)?$/;
const HOURS_AT = /(\d+(?:[.,]\d+)?)\s*(?:hrs?|hours?|h)\b[\s|@]*[$£€]?\s*(\d[\d.,]*)\s*\/\s*(?:hr|hour|h)\b/i;
const JC_AT = /(\d+)\s*JC[\s|]*[xX\u00d7][\s|]*(\d[\d.,]*)\s*[A-Z]{3}\s*\/\s*RBG/;
/** Mitchell prints labour as "Body | units | rate | add'l labor | sublet | total". */
const MITCHELL_LABOUR = /^(body|bdys|frame|mechanical|refinish|glass|structural|electrical|diagnostic)$/;
const PLAIN_NUMBER = /^\d[\d,]*(\.\d+)?$/;
const JC_BASE = /(\d+)\s*JC\s*=\s*1\s*RBG/;

const key = (text: string) => text.toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[^a-z]/g, '');
/** "K O S Z T Y   N A P R A W Y" is printed letter by letter; put the words back together. */
const unspace = (text: string) => (/^(\p{L}\s){3,}/u.test(text) ? text.replace(/(\p{L})\s(?=\p{L}(\s|$))/gu, '$1') : text).replace(/\s+/g, ' ').trim();

export interface Summary {
  estimate: Estimate;
  /** Sales tax or VAT rate printed in the block, if any. */
  taxRatePct: number | null;
}

export function parseSummary(text: string, fallbackCurrency = 'EUR'): Summary | null {
  const items: Array<EstimateItem & { role: ItemKind }> = [];
  let net: number | null = null;
  let gross: number | null = null;
  let tax: number | null = null;
  let taxRatePct: number | null = null;
  let jcBase = 10;
  let pendingLabour: { hours: number; rate: number } | null = null;
  let n = 0;
  const details: string[] = [];

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\.{3,}/g, ' | ').replace(/-{3,}/g, ' ').trim();
    if (!line) continue;
    const base = line.match(JC_BASE);
    if (base) jcBase = Number(base[1]) || 10;
    const jc = line.match(JC_AT);
    if (jc) pendingLabour = { hours: Number(jc[1]) / jcBase, rate: parseNumber(jc[2]) ?? 0 };

    const cells = line.split('|').map((c) => c.trim()).filter(Boolean);
    // A numbered detail line: keep what it is about, not its figures.
    if (items.length === 0 && /^\d{1,3}$/.test(cells[0] ?? '') && cells.length >= 3) {
      const words = cells.slice(1).filter((c) => /\p{L}{4,}/u.test(c) && !/^[A-Z0-9/&'* -]{1,8}$/.test(c));
      const longest = words.sort((a, b) => b.length - a.length)[0];
      if (longest) details.push(longest);
    }
    // A row of the block ends in an amount. The label may share its cell with a rate: "VAT 23.00 %".
    if (/^[IVX]{1,4}\.?$/.test(cells[0] ?? '')) cells.shift();
    const labelCell = unspace(cells[0] ?? '');
    const label = labelCell.replace(/[\d.,%()\s:]+$/g, '').trim();
    const numbers = cells.slice(1).filter((c) => PLAIN_NUMBER.test(c));
    if (MITCHELL_LABOUR.test(key(label)) && numbers.length >= 4 && PLAIN_NUMBER.test(cells[1] ?? '') && PLAIN_NUMBER.test(cells[2] ?? '')) {
      const hours = parseNumber(numbers[0]);
      const rate = parseNumber(numbers[1]);
      const total = parseNumber(numbers[4] ?? '') ?? (hours != null && rate != null ? Math.round(hours * rate * 100) / 100 : null);
      if (hours && rate && total) {
        const kind: ItemKind = key(label) === 'refinish' ? 'paint' : 'labour';
        n += 1;
        items.push({ id: `sum${n}`, role: kind, desc: label, kind, qty: null, hours, unitPrice: rate, total, partQuality: 'unknown' });
      }
      continue;
    }
    const role = RULES.find(([re]) => re.test(key(label)))?.[1];
    const last = cells[cells.length - 1] ?? '';
    if (!role || cells.length < 2 || !AMOUNT.test(last)) continue;
    const amount = Math.abs(parseNumber(last) ?? 0);

    if (role === 'net') net = amount;
    else if (role === 'gross') {
      gross = amount;
      // The block ends at its grand total. A supplement or an earlier version further down
      // has totals of its own, and adding those in would count the repair twice.
      if (items.length > 0) break;
    }
    else if (role === 'excess') continue;
    else if (role === 'tax') {
      tax = amount;
      const rate = line.match(/(\d+(?:[.,]\d+)?)\s*%/);
      if (rate) taxRatePct = parseNumber(rate[1]);
    } else {
      if (amount === 0) continue;
      let hours: number | null = null;
      let rate: number | null = null;
      const at = line.match(HOURS_AT);
      if (at) {
        hours = parseNumber(at[1]);
        rate = parseNumber(at[2]);
      } else if (role === 'labour' && pendingLabour) {
        hours = Math.round(pendingLabour.hours * 100) / 100;
        rate = pendingLabour.rate;
        pendingLabour = null;
      }
      // "RAZEM ..." restates the rows above it for the same category.
      if (/^(razem|total)/.test(key(label))) {
        // The rows above already say it in more detail, with hours and rates.
        if (items.some((i) => i.role === role && i.hours != null)) continue;
        for (let i = items.length - 1; i >= 0; i -= 1) if (items[i].role === role) items.splice(i, 1);
      }
      n += 1;
      items.push({ id: `sum${n}`, role, desc: label, kind: role, qty: null, hours, unitPrice: rate, total: amount, partQuality: 'unknown' });
    }
  }

  const kinds = new Set(items.map((i) => i.kind));
  const core = ['part', 'labour', 'paint'].filter((k) => kinds.has(k as ItemKind)).length;
  if (core < 2 || (net == null && gross == null)) return null;

  const rateOf = (kind: ItemKind) => {
    const timed = items.filter((i) => i.kind === kind && i.hours != null && i.unitPrice != null);
    timed.sort((a, b) => (b.hours ?? 0) - (a.hours ?? 0));
    return timed[0]?.unitPrice ?? null;
  };
  const mark = text.match(/\b(PLN|EUR|GBP|USD|CHF|CZK)\b|z[lł](?![a-ząćęłńóśźż])|€|£|\$/i)?.[0]?.toUpperCase();
  const currency = !mark ? fallbackCurrency : mark === '€' ? 'EUR' : mark === '£' ? 'GBP' : mark === '$' ? 'USD' : mark.startsWith('Z') ? 'PLN' : mark;
  // Without a net row, a grand total that exceeds the rows by a tax-sized margin is taken
  // to be the rows plus tax, so that tax is not reported as a missing line.
  const sum = Math.round(items.reduce((t, i) => t + (i.kind === 'deduction' ? -1 : 1) * (i.total ?? 0), 0) * 100) / 100;
  const lessTax = gross != null && tax != null ? Math.round((gross - tax) * 100) / 100 : null;
  const stated =
    net ?? (lessTax != null && Math.abs(lessTax - sum) <= 0.5 ? lessTax : gross != null && gross >= sum && gross - sum <= gross * 0.15 ? sum : gross);
  return {
    taxRatePct,
    estimate: {
      currency,
      labourRate: rateOf('labour'),
      paintRate: rateOf('paint'),
      statedTotal: stated,
      items: items.map(({ role: _role, ...item }) => item),
      details: details.length > 0 ? details : undefined,
    },
  };
}
