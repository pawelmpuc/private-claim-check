import { describe, expect, it } from 'vitest';
import { audit, defaultSettings, netOfItems, tierTotals } from './audit';
import { mergeEstimates, normalizeEstimate, parseCompact, parseModelJson, parseNumber } from './extract';
import { draftLetter, verifyRewrite } from './letter';
import { redact } from './redact';
import { sampleEstimate } from './sample';

const all = (ids: string[]) => new Set(ids);

describe('audit', () => {
  const estimate = sampleEstimate();
  const settings = defaultSettings('PLN');
  const findings = audit(estimate, settings);
  const byId = Object.fromEntries(findings.map((f) => [f.id, f]));

  it('adds the lines up to the printed total', () => {
    expect(netOfItems(estimate)).toBe(5437.5);
    expect(byId.arithmetic).toBeUndefined();
  });

  it('prices the labour gap at each reference rate', () => {
    // 7.5 h at 95; references 150 / 200 / 280.
    expect(byId.labourRate.amounts).toEqual({ cautious: 412.5, realistic: 787.5, optimistic: 1387.5 });
    // 5.2 h at 100.
    expect(byId.paintRate.amounts).toEqual({ cautious: 260, realistic: 520, optimistic: 936 });
  });

  it('claims deductions back in full', () => {
    expect(byId.deductions.amounts?.cautious).toBe(1715);
    expect(byId.deductions.params.count).toBe(2);
  });

  it('adds VAT on the total and on the selected shortfalls', () => {
    expect(byId.vat.amounts?.realistic).toBe(1250.63);
    const totals = tierTotals(findings, all(findings.map((f) => f.id)));
    // 3022.50 in shortfalls, 695.18 VAT on them, 1250.63 VAT on the printed total.
    expect(totals.realistic).toBe(4968.31);
    const withoutVat = tierTotals(findings, all(['labourRate', 'paintRate', 'deductions']));
    expect(withoutVat.realistic).toBe(3022.5);
  });

  it('raises questions without inventing amounts', () => {
    expect(byId.alternativeParts.amounts).toBeNull();
    expect(byId.alternativeParts.params.count).toBe(3);
    expect(byId.missingCalibration.amounts).toBeNull();
    expect(byId.missingAlignment.amounts).toBeNull();
  });

  it('finds nothing when rates match and nothing is deducted', () => {
    const clean = {
      ...estimate,
      labourRate: 300,
      paintRate: 300,
      statedTotal: null,
      items: estimate.items.filter((i) => i.kind === 'labour' || i.kind === 'paint'),
    };
    expect(audit(clean, { ...settings, claimantDeductsVat: true })).toEqual([]);
  });

  it('flags a total that does not match the lines', () => {
    const off = audit({ ...estimate, statedTotal: 5000 }, settings);
    expect(off.find((f) => f.id === 'arithmetic')?.params.diff).toBe(437.5);
  });
});

describe('extract', () => {
  it('parses numbers in European and English notation', () => {
    expect(parseNumber('1 234,50 zł')).toBe(1234.5);
    expect(parseNumber('1.234,50')).toBe(1234.5);
    expect(parseNumber('1,234.50')).toBe(1234.5);
    expect(parseNumber('12,500')).toBe(12500);
    expect(parseNumber('0,500')).toBe(0.5);
    expect(parseNumber('7,5')).toBe(7.5);
    expect(parseNumber('n/a')).toBeNull();
  });

  it('normalises a model reply', () => {
    const reply = '```json\n{"currency":"pln","labourRate":"95,00","items":[{"desc":" Zderzak ","kind":"part","total":-1240,"partQuality":"alternative"},{"desc":"","kind":"x","total":1}]}\n```';
    const est = normalizeEstimate(parseModelJson(reply));
    expect(est.currency).toBe('PLN');
    expect(est.labourRate).toBe(95);
    expect(est.items).toHaveLength(1);
    expect(est.items[0]).toMatchObject({ desc: 'Zderzak', total: 1240, partQuality: 'alternative' });
  });

  it('drops section headings and total rows', () => {
    const est = normalizeEstimate({
      currency: 'PLN',
      items: [
        { desc: 'ROBOCIZNA', kind: 'other', total: null, partQuality: 'unknown' },
        { desc: 'Wymiana zderzaka', kind: 'labour', hours: 3.4, total: 323, partQuality: 'unknown' },
        { desc: 'RAZEM KOSZT NAPRAWY NETTO', kind: 'other', total: 5437.5, partQuality: 'unknown' },
        { desc: 'Utylizacja odpadów', kind: 'other', total: 40, partQuality: 'unknown' },
      ],
    });
    expect(est.items.map((i) => i.desc)).toEqual(['Wymiana zderzaka', 'Utylizacja odpadów']);
  });

  it('parses the on-device line format', () => {
    const est = parseCompact(`CURRENCY: PLN
LABOUR_RATE: 95,00
PAINT_RATE: -
TOTAL: 5 437,50
part | alt | - | 1240.00 | Zderzak przedni
- labour | - | 3,4 | 323.00 | Wymiana zderzaka | i reflektora
deduction | - | - | -1593.00 | Amortyzacja części 30%
other | - | - | 5437.50 | RAZEM KOSZT NAPRAWY NETTO
this line is noise`);
    expect(est).toMatchObject({ currency: 'PLN', labourRate: 95, paintRate: null, statedTotal: 5437.5 });
    expect(est.items.map((i) => [i.kind, i.partQuality, i.hours, i.total, i.desc])).toEqual([
      ['part', 'alternative', null, 1240, 'Zderzak przedni'],
      ['labour', 'unknown', 3.4, 323, 'Wymiana zderzaka | i reflektora'],
      ['deduction', 'unknown', null, 1593, 'Amortyzacja części 30%'],
    ]);
  });

  it('merges pages and keeps the last total', () => {
    const a = normalizeEstimate({ currency: 'PLN', labourRate: 95, statedTotal: 100, items: [{ desc: 'a', kind: 'part', total: 1 }] });
    const b = normalizeEstimate({ currency: 'PLN', statedTotal: 900, items: [{ desc: 'b', kind: 'labour', total: 2 }] });
    const merged = mergeEstimates([a, b]);
    expect(merged.items).toHaveLength(2);
    expect(merged.labourRate).toBe(95);
    expect(merged.statedTotal).toBe(900);
  });
});

describe('letter', () => {
  const estimate = sampleEstimate();
  const findings = audit(estimate, defaultSettings('PLN'));
  const selected = all(findings.map((f) => f.id));

  it('states the same total as the audit', () => {
    const letter = draftLetter(estimate, findings, selected, 'realistic', 'pl');
    expect(letter.replace(/ /g, ' ')).toContain('4968,31 zł');
    expect(letter).toContain('[CLAIM NUMBER]');
  });

  it('accepts a rewrite that keeps numbers and placeholders', () => {
    const draft = draftLetter(estimate, findings, selected, 'cautious', 'en');
    expect(verifyRewrite(draft, draft.replace('Dear Sir or Madam', 'To whom it may concern')).ok).toBe(true);
  });

  it('rejects a rewrite that changes an amount, drops one, or drops a placeholder', () => {
    const draft = draftLetter(estimate, findings, selected, 'cautious', 'en');
    expect(verifyRewrite(draft, draft.replace('1,715.00', '1,915.00')).reason).toBe('number_added');
    expect(verifyRewrite(draft, `${draft}\nPay within 7 days.`).reason).toBe('number_added');
    expect(verifyRewrite(draft, draft.replace(/1,715\.00/g, 'the amount')).reason).toBe('number_missing');
    expect(verifyRewrite(draft, draft.split('[CLAIM NUMBER]').join('unknown')).reason).toBe('placeholder_missing');
  });
});

describe('redact', () => {
  it('removes pattern-based identifiers and counts them', () => {
    const out = redact('Jan Kowalski, jan@example.com, tel. 600 700 800, VIN WVWZZZ1KZAW123456, rej. DW 12345, PESEL 80010112345');
    expect(out.text).not.toMatch(/jan@example|600 700 800|WVWZZZ1KZAW123456|DW 12345|80010112345/);
    expect(out.count).toBe(5);
  });

  it('leaves amounts alone', () => {
    expect(redact('Zderzak 1 240,00 PLN, robocizna 3,4 h x 95,00').count).toBe(0);
  });
});
