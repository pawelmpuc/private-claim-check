import { describe, expect, it } from 'vitest';
import { audit, defaultSettings, netOfItems, tierTotals } from './audit';
import { mergeEstimates, normalizeEstimate, parseModelJson, parseNumber, parsePastedText, parseTranscription } from './extract';
import { draftLetter, verifyRewrite } from './letter';
import { redact } from './redact';
import { countryForCurrency } from './countries';
import { sampleEstimate } from './sample';

const all = (ids: string[]) => new Set(ids);

describe('audit', () => {
  const estimate = sampleEstimate();
  const settings = defaultSettings('PLN', 23);
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

  // These are transcriptions Gemini Nano produced in Chrome from the sample estimate, mistakes included.
  const TOP = `**CZĘŚCI ZAMIENNE**
Zderzak przedni | Q | 1 | 1 240,00 | 1 240,00
Reflektor lewy LED | O | 1 | 2 890,00 | 2 890,00
Blotnik przedni lewy | PJ | 1 | 760,00 | 760,00
Wahacz przedni lewy | Q | 1 | 420,00 | 420,00

**ROBOTCZINA**
Wymiana zderzaka i reflektora | 3,4 | 95,00 | 323,00
Wymiana blotnika i wahacza | 4,1 | 95,00 | 389,50

**LAKIEROWANIE**
Lakierowanie zderzaka i blotnika | 5,2 | 100,00 | 520,00

**POTRA CENIA**
Amortyzacja części 30% | - | - | -1 593,00
Rabat na materiał lakierniczy 20% | | | -122,00

RAZEM KOST NETTO | | | 5 437,50`;
  const BAND_A = `CZĘŚCI ZAMIENNE | Jakość | Ilość / rbh | Cena jedn. | Netto PLN
1 | Zderzak przedni | Q | 1 | 1 240,00 | 1 240,00
2 | Reflektor lewy LED | O | 1 | 2 890,00 | 2 890,00
3 | Blotnik przedni lewy | PJ | 1 | 760,00 | 760,00
4 | Wahacz przedni lewy | Q | 1 | 420,00 | 420,00
ROBOTCZINA | Wymiana zderzaka i reflektora | 3,4 | 95,00 | 323,00
`;
  const BAND_B = `Robocizna | Ekspertyza i reflektora | 3,4 | 95,00 | 323,00
Robocizna | Wymiana błotnika i wahacza | 4,1 | 95,00 | 389,50
Lakierowanie | Lakierowanie zderzaka i błotnika | 5,2 | 100,00 | 520,00
Potrącenia | Materiał lakierniczy | 1 | 610,00 | 610,00
Potrącenia | Amortyzacja części 30% | - | | -1 593,00
Potrącenia | Rabat na materiał lakierniczy 20% | | | -122,00
Razem koszt naprawy netto | | | | 5 437,50`;

  it('structures a real on-device transcription of a whole page', () => {
    const est = parseTranscription([TOP]);
    expect(est).toMatchObject({ labourRate: 95, paintRate: 100, statedTotal: 5437.5 });
    expect(est.items.map((i) => [i.kind, i.partQuality, i.hours, i.total])).toEqual([
      ['part', 'alternative', null, 1240],
      ['part', 'oem', null, 2890],
      ['part', 'alternative', null, 760],
      ['part', 'alternative', null, 420],
      ['labour', 'unknown', 3.4, 323],
      ['labour', 'unknown', 4.1, 389.5],
      ['paint', 'unknown', 5.2, 520],
      ['deduction', 'unknown', null, 1593],
      ['deduction', 'unknown', null, 122],
    ]);
  });

  it('joins overlapping tiles and does not turn a mislabelled row into a deduction', () => {
    const est = parseTranscription([BAND_A, BAND_B]);
    expect(est).toMatchObject({ currency: 'PLN', labourRate: 95, paintRate: 100, statedTotal: 5437.5 });
    expect(est.items.map((i) => [i.kind, i.total])).toEqual([
      ['part', 1240],
      ['part', 2890],
      ['part', 760],
      ['part', 420],
      ['labour', 323],
      ['labour', 389.5],
      ['paint', 520],
      ['material', 610],
      ['deduction', 1593],
      ['deduction', 122],
    ]);
    expect(netOfItems(est)).toBe(5437.5);
  });

  it('repairs hours from rate and amount, and reads a heading that replaced a description', () => {
    const est = parseTranscription([
      `Części zamienne |
Zderzak przedni | Q | 1 | 1 240,00 | 1 240,00 |
Reflektor lewy LED | O | 1 | 2 890,00 | 2 890,00 |`,
      `Zderzak przedni | 1 | 1 240,00 | 1 240,00
Reflektor lewy LED | 1 | 2 890,00 | 2 890,00
Blotnik przedni lewy | 1 | 760,00 | 760,00
ROBOTCZNA | 5 | 95,00 | 323,00
| 6 | 95,00 | 389,50
LAKIEROWANIE | 7 | 100,00 | 520,00
Rabat | | | 0,00`,
    ]);
    expect(est.items.map((i) => [i.kind, i.hours, i.total, i.desc])).toEqual([
      ['part', null, 1240, 'Zderzak przedni'],
      ['part', null, 2890, 'Reflektor lewy LED'],
      ['part', null, 760, 'Blotnik przedni lewy'],
      ['labour', 3.4, 323, 'ROBOTCZNA'],
      ['labour', 4.1, 389.5, '?'],
      ['paint', 5.2, 520, 'LAKIEROWANIE'],
    ]);
    expect(est.labourRate).toBe(95);
  });

  it('uses the printed total to settle an amount the model split in two', () => {
    // Real output: the printed "-1 593,00" came back as the cells "-1" and "593,00".
    const est = parseTranscription([
      `CURRENCY: PLN
**CZĘŚCI ZAMIENNE** | Zderzak przędni | Q | 1 | 1 240,00 | 1 240,00 |
|---|---|---|---|---|---|
|---| Reflektor lewy LED | O | 1 | 2 890,00 | 2 890,00 |
|---| Blotnik przedni lewy | PJ | 1 | 760,00 | 760,00 |
|---| Wahacz przedni | Q | 1 | 420,00 | 420,00 |
|---| **ROBOTCZINA** | Wymiana zderzaka i reflektora | 3,4 | 95,00 | 323,00 |
**Razem** | | | | | **1 916,00** |`,
      `Robocizna | Wymiana zderzaka i reflektora | 3,4 | 95,00 | 323,00
Robocizna | Wymiana botnika i wahacza | 4,1 | 95,00 | 389,50
Lakierowanie | Lakierowanie zderzaka i botnika | 5,2 | 100,00 | 520,00
Lakierowanie | Materiał lakierniczy | 1 | 610,00 | 610,00
Potrącenia | Amortyzacja części 30% | -1 | 593,00 | -593,00
Potrącenia | Rabat na materiał lakierniczy 20% | -1 | 122,00 | -122,00
Razem koszt naprawy netto | | | | 5 437,50`,
    ]);
    expect(est).toMatchObject({ currency: 'PLN', labourRate: 95, paintRate: 100, statedTotal: 5437.5 });
    expect(est.items.map((i) => [i.kind, i.hours, i.total])).toEqual([
      ['part', null, 1240],
      ['part', null, 2890],
      ['part', null, 760],
      ['part', null, 420],
      ['labour', 3.4, 323],
      ['labour', 4.1, 389.5],
      ['paint', 5.2, 520],
      ['material', null, 610],
      ['deduction', null, 1593],
      ['deduction', null, 122],
    ]);
    expect(est.items.some((i) => i.check)).toBe(false);
    expect(netOfItems(est)).toBe(5437.5);
  });

  it('reads part quality written as words and a total with comma thousands', () => {
    const est = parseTranscription([
      `No. | Description | Part type | Qty / hours | Unit price | Net GBP
PARTS
1 | Front bumper | Non-OEM | 1 | 310.00 | 310.00
2 | Left LED headlamp | OEM | 1 | 720.00 | 720.00
3 | Left front wing | Used | 1 | 190.00 | 190.00
LABOUR
4 | Replace bumper and headlamp | 3.4 | 38.00 | 129.20
DEDUCTIONS
5 | Betterment on parts 30% | -366.00
TOTAL REPAIR COST NET | 983.20`,
    ]);
    expect(est.currency).toBe('GBP');
    expect(est.statedTotal).toBe(983.2);
    expect(est.items.map((i) => [i.desc, i.kind, i.partQuality, i.total])).toEqual([
      ['Front bumper', 'part', 'alternative', 310],
      ['Left LED headlamp', 'part', 'oem', 720],
      ['Left front wing', 'part', 'used', 190],
      ['Replace bumper and headlamp', 'labour', 'unknown', 129.2],
      ['Betterment on parts 30%', 'deduction', 'unknown', 366],
    ]);
    expect(est.labourRate).toBe(38);
  });

  it('drops numbered rows the model wrote twice', () => {
    // Real output for the English sample: row 1 came back a second time under the next heading,
    // and row 4 again at the top of the second tile.
    const est = parseTranscription([
      `Parts | 1 | Front bumper | Non-OEM | 1 | 310.00 | 310.00
|---|---|---|---|---|---|---
| 2 | Left LED headlamp | OEM | 1 | 720.00 | 720.00
| 3 | Left front wing | Non-OEM | 1 | 190.00 | 190.00
| 4 | Left front suspension arm | Non-OEM | 1 | 105.00 | 105.00
| Labour | | | | | | |
| No. | Description | Part type | Qty / hours | Unit price | Net GBP |
| 1 | Front bumper | Non-OEM | 1 | 310.00 | 310.00`,
      `4 | Left front suspension arm | Non-OEM | 1 | 105.00 | 105.00
LABOUR |
5 | Replace bumper and headlamp | 3.4 | 38.00 | 129.20
6 | Replace wing and suspension arm | 4.1 | 38.00 | 155.80
PAINT |
7 | Paint bumper and wing | 5.2 | 40.00 | 208.00
8 | Paint materials | 1 | 150.00 | 150.00
DEDUCTIONS |
9 | Betterment on parts 30% | -397.50 |
10 | Discount on paint materials 20% | -30.00 |
TOTAL REPAIR COST NET | 1,540.50`,
    ]);
    expect(est).toMatchObject({ currency: 'GBP', labourRate: 38, paintRate: 40, statedTotal: 1540.5 });
    expect(est.items.map((i) => [i.kind, i.partQuality, i.hours, i.total])).toEqual([
      ['part', 'alternative', null, 310],
      ['part', 'oem', null, 720],
      ['part', 'alternative', null, 190],
      ['part', 'alternative', null, 105],
      ['labour', 'unknown', 3.4, 129.2],
      ['labour', 'unknown', 4.1, 155.8],
      ['paint', 'unknown', 5.2, 208],
      ['material', 'unknown', null, 150],
      ['deduction', 'unknown', null, 397.5],
      ['deduction', 'unknown', null, 30],
    ]);
    expect(netOfItems(est)).toBe(1540.5);
  });

  it('structures pasted text without a model', () => {
    const est = parsePastedText(`Kosztorys nr 55/2026, Jan Kowalski, tel. 600 700 800, VIN WVWZZZ1KZAW123456
Data: 12.11.2026
Części zamienne:
Zderzak przedni Q 1 szt. 1 240,00 zł
Reflektor lewy O 1 szt. 2 890,00 zł
Robocizna:
Wymiana zderzaka 3,4 rbh x 95,00 = 323,00 zł
Lakierowanie:
Lakierowanie zderzaka 5,2 rbh x 100,00 = 520,00 zł
Potrącenia:
Amortyzacja części 30% -1 239,00 zł
Razem netto: 3 734,00 zł`);
    expect(est).toMatchObject({ currency: 'PLN', labourRate: 95, paintRate: 100, statedTotal: 3734 });
    expect(est!.items.map((i) => [i.desc, i.kind, i.partQuality, i.hours, i.total])).toEqual([
      ['Zderzak przedni', 'part', 'alternative', null, 1240],
      ['Reflektor lewy', 'part', 'oem', null, 2890],
      ['Wymiana zderzaka', 'labour', 'unknown', 3.4, 323],
      ['Lakierowanie zderzaka', 'paint', 'unknown', 5.2, 520],
      ['Amortyzacja części', 'deduction', 'unknown', null, 1239],
    ]);
    expect(netOfItems(est!)).toBe(3734);
  });

  it('reads English pasted text and leaves prose to the model', () => {
    const est = parsePastedText(`Parts: Front bumper Non-OEM 1 x £310.00 = £310.00; Left headlamp OEM 1 x £720.00 = £720.00
Labour: Replace bumper and headlamp 3.4 h at £38.00 = £129.20
Betterment on parts 30% -£309.00
Total net £850.20`);
    expect(est).toMatchObject({ currency: 'GBP', labourRate: 38, statedTotal: 850.2 });
    expect(est!.items.map((i) => [i.kind, i.total])).toEqual([['part', 310], ['part', 720], ['labour', 129.2], ['deduction', 309]]);
    expect(parsePastedText('The insurer offered me about 3000 for the repair and I think it is too low.')).toBeNull();
  });

  it('marks a doubtful amount when there is no total to settle it', () => {
    const est = parseTranscription(['Potrącenia | Amortyzacja części 30% | -1 | 593,00 | -593,00']);
    expect(est.items[0]).toMatchObject({ kind: 'deduction', total: 593, check: true });
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
  const findings = audit(estimate, defaultSettings('PLN', 23));
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

describe('countries', () => {
  it('follows the currency of the estimate and keeps a fitting choice', () => {
    expect(countryForCurrency('PLN', 'GB')).toBe('PL');
    expect(countryForCurrency('EUR', 'NL')).toBe('NL');
    expect(countryForCurrency('EUR', 'PL')).toBe('IE');
    expect(countryForCurrency('CHF', 'PL')).toBe('OTHER');
  });
});
