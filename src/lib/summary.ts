import { parseNumber } from './extract';
import type { Estimate, EstimateItem, ItemKind } from './types';

/**
 * Reads the totals block that estimating systems print at the end of an estimate:
 * "ESTIMATE TOTALS" in CCC ONE, "KALKULACJA KOŃCOWA" in Audatex. Real estimates carry
 * separate columns for labour and paint hours on every line, so the line table is hard
 * to price row by row. The totals block states the same thing in a few rows: hours,
 * hourly rates, parts, deductions and the total.
 */

type Role = ItemKind | 'net' | 'gross' | 'tax' | 'excess' | 'finalNet' | 'finalGross';

const RULES: Array<[RegExp, Role]> = [
  [/^(parts|totalparts|partstotal|totalreplacementparts(amount)?|(razem)?czescizamienne|(gesamtsumme)?ersatzteile|kleinersatzteile)$/, 'part'],
  [/^((body|mechanical|frame|structural|glass|electrical|diagnostic|total)?labou?r|(razem)?robocizna|gesamtsummearbeitslohn|blacharz|mechanik|elektryk|tapicer|pracedodatkowe)$/, 'labour'],
  [/^(paintlabou?r|refinishlabou?r|refinish|kosztyrobocizny|arbeitskosten|lakiernik|lakierowanie)$/, 'paint'],
  [/^(paintsupplies|paintmaterials?|paintandmaterials?|kosztymaterialu|materialkosten|lackiermaterial|materiallakierniczy)$/, 'material'],
  [/^(miscellaneous|sublet|subletrepairs|towing|storage|(total)?additionalcosts?|shopsupplies|hazardouswaste|razemkosztydodatkowe|gesamtsummenebenkosten|matdrobneidodatkowe.*)$/, 'other'],
  [/^(betterment|depreciation|(total)?adjustments?|discount|appearanceallowance|amortyzacja.*|(razem)?potraceni[ae].*|ubytekwartosci.*|urealnienie.*|rabat.*)$/, 'deduction'],
  [/^(subtotal|netcostofrepairs|kosztynaprawybezvat|wartoscbezvat|reparaturkostenohnemwst|koszty?naprawy(lacznie)?netto|wartosclacznienetto)$/, 'net'],
  [/^(grandtotal|totalcostofrepairs|grosstotal|estimatetotal|kosztynaprawyzvat|wartosczvat|reparaturkostenmitmwst|koszty?naprawy(lacznie)?brutto|wartosclaczniebrutto)$/, 'gross'],
  // Eurotax prints the VAT on materials and on labour as two rows.
  [/^(salestax|tax|vat|mwst|vat(material|robocizna))$/, 'tax'],
  [/^(deductible|excess|udzialwlasny)$/, 'excess'],
  // Audatex prints its deductions after the gross total, then a second pair of totals.
  [/^suma(koncowa|ogolna)bezvat/, 'finalNet'],
  [/^suma(koncowa|ogolna)zvat/, 'finalGross'],
];

/** Section headings of an Audatex calculation, printed letter by letter. "Labour" means paint labour in the paint section. */
type Section = 'labour' | 'paint' | 'part' | 'other' | 'deduction' | null;
const SECTIONS: Array<[RegExp, Exclude<Section, null>]> = [
  [/^(robocizna|arbeitslohn)/, 'labour'],
  [/^(lakierowanie|lackierung)/, 'paint'],
  [/^(czescizamienne|ersatzteile)/, 'part'],
  [/^(kosztydodatkowe|nebenkosten)/, 'other'],
  [/^(potracenia|abzuege)/, 'deduction'],
];

const AMOUNT = /^[-−(]?\s*[$£€]?\s*\d[\d\s .,]*[.,]\d{2}\)?-?$/;
const HOURS_AT = /(\d+(?:[.,]\d+)?)\s*(?:hrs?|hours?|h)\b[\s|@]*[$£€]?\s*(\d[\d.,]*)\s*\/\s*(?:hr|hour|h)\b/i;
/** Audatex time units: "12 JC | X | 52.00 | PLN/RBG" in Polish, "7 AW | X | 137.00 | EUR/STD" in German. */
const JC_AT = /(\d+(?:[.,]\d+)?)\s*(?:JC|AW)[\s|]*[xX×][\s|]*(\d[\d.,]*)[\s|]*[A-Z]{3}\s*\/\s*(?:RBG|STD)/;
const JC_BASE = /(\d+)\s*(?:JC|AW)\s*=\s*1\s*(?:RBG|STD)/;
/** The line that closes the paint time table: "KOŃCOWA ROBOCIZNA LAKIER | 10 JC/RBG : | 54 | 280.80". */
const PAINT_TIME = /(?:KO[ŃN]COWA ROBOCIZNA LAKIER|GESAMT-LACKIERZEIT)[\s|]*(\d+)\s*(?:JC|AW)\s*\/\s*(?:RBG|STD)\s*:?[\s|]*(\d+(?:[.,]\d+)?)[\s|]+(\d[\d ]*[.,]\d{2})\s*$/;
/** Mitchell prints labour as "Body | units | rate | add'l labor | sublet | total". */
const MITCHELL_LABOUR = /^(body|bdys|frame|mechanical|refinish|glass|structural|electrical|diagnostic)$/;
const PLAIN_NUMBER = /^\d[\d,]*(\.\d+)?$/;
/** A cell that starts the figures of a row: an amount, a rate, a number of hours or units. */
const FIGURE = /^[-−(]?\s*[$£€]?\s*\d/;
const CURRENCY_CELL = /^(PLN|EUR|GBP|USD|CHF|CZK|z[lł])$/i;
/** Amounts in Audatex blocks carry a trailing minus: "73.20-". */
const num = (cell: string) => parseNumber(cell.replace(/\s*[-−]$/, ''));

const key = (text: string) => text.toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[^a-z]/g, '');
const SPACED = /^(\p{L}\s){3,}/u;
/** "K O S Z T Y   N A P R A W Y" is printed letter by letter; put the words back together. */
const unspace = (text: string) => (SPACED.test(text) ? text.replace(/(\p{L})\s(?=\p{L}(\s|$))/gu, '$1') : text).replace(/\s+/g, ' ').trim();
const round2 = (v: number) => Math.round(v * 100) / 100;

export interface Summary {
  estimate: Estimate;
  /** Sales tax or VAT rate printed in the block, if any. */
  taxRatePct: number | null;
}

export function parseSummary(text: string, fallbackCurrency = 'EUR'): Summary | null {
  const items: Array<EstimateItem & { role: ItemKind }> = [];
  let net: number | null = null;
  let gross: number | null = null;
  let finalNet: number | null = null;
  let tax: number | null = null;
  let taxRatePct: number | null = null;
  let jcBase = 10;
  let section: Section = null;
  /** Time units and money of the time rows seen in the current section, waiting for its total. */
  let pending: { units: number; money: number; rates: Set<number> } | null = null;
  let paintTime: { hours: number; total: number } | null = null;
  /** After the gross total only an Audatex deductions section may follow. */
  let afterGross = false;
  let lastRole: Role | null = null;
  /** The block heading states its currency: "K A L K U L A C J A K O Ń C O W A | PLN | PLN". */
  let blockCurrency: string | null = null;
  let n = 0;
  const details: string[] = [];
  const hasCore = () => items.some((i) => i.role === 'part' || i.role === 'labour' || i.role === 'paint');

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\.{3,}/g, ' | ').replace(/-{3,}/g, ' ').trim();
    if (!line) continue;
    const base = line.match(JC_BASE);
    if (base) jcBase = Number(base[1]) || 10;
    const pt = line.match(PAINT_TIME);
    if (pt) {
      const hours = (parseNumber(pt[2]) ?? 0) / (Number(pt[1]) || 10);
      const total = parseNumber(pt[3]);
      if (hours > 0 && total) paintTime = { hours: round2(hours), total };
    }

    const cells = line.split('|').map((c) => c.trim()).filter(Boolean);
    // A numbered detail line: keep what it is about, not its figures.
    if (items.length === 0 && /^\d{1,3}$/.test(cells[0] ?? '') && cells.length >= 3) {
      const words = cells.slice(1).filter((c) => /\p{L}{4,}/u.test(c) && !/^[A-Z0-9/&'* -]{1,8}$/.test(c));
      const longest = words.sort((a, b) => b.length - a.length)[0];
      if (longest) details.push(longest);
    }
    if (/^[IVX]{1,4}\.?$/.test(cells[0] ?? '')) cells.shift();
    // The label is every cell before the first figure; letter-spaced headings come split over several cells.
    const first = cells.findIndex((c) => FIGURE.test(c));
    const labelCells = (first < 0 ? cells : cells.slice(0, first)).filter((c) => !CURRENCY_CELL.test(c));
    const label = labelCells.map(unspace).join(' ').replace(/[\d.,%()\s:-]+$/g, '').trim();
    const k = key(label);

    if (SPACED.test(cells[0] ?? '')) {
      const cur = cells.length >= 2 && CURRENCY_CELL.test(cells[cells.length - 1]) ? cells[cells.length - 1].toUpperCase() : null;
      if (cur && !blockCurrency) blockCurrency = cur.startsWith('Z') ? 'PLN' : cur;
      section = SECTIONS.find(([re]) => re.test(k))?.[1] ?? null;
      pending = null;
    }
    const jc = line.match(JC_AT);
    if (jc && section !== 'other' && section !== 'part' && section !== 'deduction') {
      const units = parseNumber(jc[1]) ?? 0;
      const rate = parseNumber(jc[2]) ?? 0;
      pending ??= { units: 0, money: 0, rates: new Set() };
      pending.units += units;
      pending.money += (units / jcBase) * rate;
      pending.rates.add(rate);
    }

    const numbers = cells.slice(1).filter((c) => PLAIN_NUMBER.test(c));
    if (!afterGross && MITCHELL_LABOUR.test(key(cells[0] ?? '')) && numbers.length >= 4 && PLAIN_NUMBER.test(cells[1] ?? '') && PLAIN_NUMBER.test(cells[2] ?? '')) {
      const hours = parseNumber(numbers[0]);
      const rate = parseNumber(numbers[1]);
      const total = parseNumber(numbers[4] ?? '') ?? (hours != null && rate != null ? round2(hours * rate) : null);
      if (hours && rate && total) {
        const kind: ItemKind = key(cells[0]) === 'refinish' ? 'paint' : 'labour';
        n += 1;
        items.push({ id: `sum${n}`, role: kind, desc: cells[0], kind, qty: null, hours, unitPrice: rate, total, partQuality: 'unknown' });
      }
      continue;
    }
    let role = RULES.find(([re]) => re.test(k))?.[1];
    // The figures that close the row: "Blacharz | 3,80 | 85,00 | 323,00".
    let end = cells.length;
    while (end > 0 && FIGURE.test(cells[end - 1])) end -= 1;
    const figs = cells.slice(end).filter((c) => !/%/.test(c)).map(num).filter((v): v is number => v != null);
    // A summary printed beside an address block: "02-670 Warszawa | Koszt naprawy (netto) | 2 449,90".
    let rowLabel = label;
    if (!role && end > 0 && end < cells.length) {
      const near = (cells[end - 1] ?? '').replace(/[\d.,%()\s:-]+$/g, '').trim();
      role = near ? RULES.find(([re]) => re.test(key(near)))?.[1] : undefined;
      if (role) rowLabel = near;
    }
    // In the paint section the paint labour is just "labour".
    if (section === 'paint' && (role === 'labour' || k === 'arbeitslohn')) role = 'paint';
    const last = cells[cells.length - 1] ?? '';
    if (!role || cells.length < 2 || !AMOUNT.test(last)) continue;
    const amount = Math.abs(num(last) ?? 0);
    const prevRole = lastRole;
    lastRole = role;

    if (afterGross) {
      // A supplement or an earlier version further down has totals of its own; adding those
      // in would count the repair twice. Only the deductions that belong to this total go on.
      if (role === 'finalNet') finalNet = amount;
      else if (role === 'finalGross') break;
      else if (role === 'tax' || role === 'excess') continue;
      else if (role === 'deduction' && section === 'deduction') {
        if (amount > 0) addRow(role, rowLabel, amount, line, []);
      } else break;
      continue;
    }
    if (role === 'net') net = amount;
    else if (role === 'gross') {
      gross = amount;
      if (hasCore()) afterGross = true;
    } else if (role === 'finalNet' || role === 'finalGross' || role === 'excess') continue;
    else if (role === 'tax') {
      tax = prevRole === 'tax' && tax != null ? round2(tax + amount) : amount;
      const rate = line.match(/(\d+(?:[.,]\d+)?)\s*%/);
      if (rate) taxRatePct = parseNumber(rate[1]);
    } else {
      if (amount === 0) continue;
      // A cover page may list deductions before any of the repair itself; the block repeats them.
      if (role === 'deduction' && !hasCore()) continue;
      // DEKRA: "Lakierowanie | hours | labour | materials | total" in one row.
      if (role === 'paint' && figs.length === 4 && Math.abs(figs[1] + figs[2] - figs[3]) <= 0.02) {
        addRow('paint', rowLabel, figs[1], line, figs.slice(0, 3));
        addRow('material', rowLabel, figs[2], line, []);
        continue;
      }
      addRow(role, rowLabel, amount, line, figs);
    }
  }

  function addRow(role: ItemKind, label: string, amount: number, line: string, figs: number[]) {
    let hours: number | null = null;
    let rate: number | null = null;
    const at = line.match(HOURS_AT);
    if (at) {
      hours = parseNumber(at[1]);
      rate = parseNumber(at[2]);
    } else if ((role === 'labour' || role === 'paint') && pending && pending.units > 0) {
      // The time rows above add up to this total: keep their hours and rate.
      if (Math.abs(round2(pending.money) - amount) <= 0.05) {
        hours = round2(pending.units / jcBase);
        rate = pending.rates.size === 1 ? [...pending.rates][0] : round2(amount / hours);
      }
      pending = null;
    } else if ((role === 'labour' || role === 'paint') && figs.length >= 3 && figs[0] > 0 && figs[0] < 500) {
      // Eurotax: "Blacharz | 3,80 | 85,00 | 323,00"; DEKRA: "Robocizna | 4.8 | 528,00 | 528,00".
      const h = figs[0];
      if (Math.abs(round2(h * figs[1]) - amount) <= 0.05) [hours, rate] = [h, figs[1]];
      else if (Math.abs(figs[1] - amount) <= 0.02) [hours, rate] = [h, round2(amount / h)];
    }
    // "RAZEM ..." restates the rows above it for the same category.
    if (/^(razem|total|gesamtsumme)/.test(key(label))) {
      const same = items.filter((i) => i.role === role);
      if (same.some((i) => i.hours != null)) return;
      const sum = round2(same.reduce((t, i) => t + (i.total ?? 0), 0));
      // The rows above already say it in more detail.
      if (same.length > 0 && Math.abs(sum - amount) <= 0.02) return;
      for (let i = items.length - 1; i >= 0; i -= 1) if (items[i].role === role) items.splice(i, 1);
    }
    n += 1;
    items.push({ id: `sum${n}`, role, desc: label, kind: role, qty: null, hours, unitPrice: rate, total: amount, partQuality: 'unknown' });
  }

  // Audatex states the paint time on the paint page and the paint labour cost in the block.
  if (paintTime) {
    const paint = items.find((i) => i.kind === 'paint' && i.hours == null && Math.abs((i.total ?? 0) - paintTime!.total) <= 0.02);
    if (paint) {
      paint.hours = paintTime.hours;
      paint.unitPrice = round2((paint.total ?? 0) / paintTime.hours);
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
  const mark = text.match(/\b(PLN|EUR|GBP|USD|CHF|CZK)\b|(?<![\p{L}\d])z[lł](?!\p{L})|€|£|\$/iu)?.[0]?.toUpperCase();
  const fromMark = !mark ? fallbackCurrency : mark === '€' ? 'EUR' : mark === '£' ? 'GBP' : mark === '$' ? 'USD' : mark.startsWith('Z') ? 'PLN' : mark;
  const currency = blockCurrency ?? fromMark;
  // Without a net row, a grand total that exceeds the rows by a tax-sized margin is taken
  // to be the rows plus tax, so that tax is not reported as a missing line.
  const sum = round2(items.reduce((t, i) => t + (i.kind === 'deduction' ? -1 : 1) * (i.total ?? 0), 0));
  const lessTax = gross != null && tax != null ? round2(gross - tax) : null;
  // Deductions printed after the gross total come with a net total of their own.
  const stated =
    finalNet ??
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
