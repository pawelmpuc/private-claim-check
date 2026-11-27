import { describe, expect, it } from 'vitest';
import { audit, defaultSettings, netOfItems, sumMismatch, tierTotals } from './audit';
import { mergeEstimates, normalizeEstimate, parseDocumentText, parseModelJson, parseNumber, parsePastedText, parseTranscription } from './extract';
import { hasTextLayer, layoutLines } from './pdftext';
import { explainPrompt, inventedFigure } from './explain';
import { applyPolish, draftLetter, joinLetter, letterParts, polishPrompt, verifyRewrite } from './letter';
import { redact } from './redact';
import { countryForCurrency } from './countries';
import { compareQuote } from './compare';
import { sampleEstimate, sampleQuote } from './sample';

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

  it('cuts a tile written as one line back into rows', () => {
    // Real output for the sample quote: the whole first tile came back without a line break.
    const est = parseTranscription([
      'No. Q-2026-0457 | Date: 19/11/2026 | Valid for 30 days Customer: Jane Sample, 1 Test Street, Sampletown AB1 2CD, tel. 07700 900123 Vehicle: passenger car, 2021, reg. AB21 XYZ, VIN WWWZZZIZKAWI123456 | Labour rates: bodywork and mechanical 72.00 GBP per hour, paint 75.00 GBP per hour | No. | Description | Part type | Qty / hours | Unit price | Net GBP | 1 | Front bumper | OEM | 1 | 465.00 | 465.00 | 2 | Left LED headlamp | OEM | 1 | 720.00 | 720.00 | 3 | Left front wing | OEM | 1 | 285.00 | 285.00 | 4 | Left front suspension arm | OEM | 1 | 160.00 | 160.00 | 0 |  |  |  |  |  | 0 |',
      `Left front suspension arm | OEM | 1 | 160.00
LABOUR | | |
Replace bumper and headlamp | 4.0 | 72.00 | 288.00
Replace wing and suspension arm | 5.0 | 72.00 | 360.00
PAINT | | |
Paint bumper and wing | 6.0 | 75.00 | 450.00
Paint materials | 1 | 195.00 | 195.00
ADDITIONAL WORK | | |
Headlamp calibration | 1 | 90.00 | 90.00
Wheel alignment | 1 | 65.00 | 65.00
TOTAL NET | 3,078.00`,
    ]);
    expect(est.items.map((i) => [i.desc, i.kind, i.total])).toEqual([
      ['Front bumper', 'part', 465],
      ['Left LED headlamp', 'part', 720],
      ['Left front wing', 'part', 285],
      ['Left front suspension arm', 'part', 160],
      ['Replace bumper and headlamp', 'labour', 288],
      ['Replace wing and suspension arm', 'labour', 360],
      ['Paint bumper and wing', 'paint', 450],
      ['Paint materials', 'material', 195],
      ['Headlamp calibration', 'other', 90],
      ['Wheel alignment', 'other', 65],
    ]);
    expect(est.statedTotal).toBe(3078);
    expect(netOfItems(est)).toBe(3078);
  });

  it('classifies rows by their own words when the second tile came back without headings', () => {
    // Real output for the scan of the sample quote.
    const est = parseTranscription([
      `Parts
Front bumper cover | OEM | 1 | 465.00 | 465.00
Left LED headlamp | OEM | 1 | 720.00 | 720.00
Left fender | OEM | 1 | 285.00 | 285.00
Left lower control arm | OEM | 1 | 160.00 | 160.00

Labor
Total USD | 2130.00`,
      `3 Left fender | OEM | 1 | 285.00
4 Left lower control arm | OEM | 1 | 160.00
5 Replace bumper and headlamp | 4.0 | 72.00 | 288.00
6 Replace fender and control arm | 5.0 | 72.00 | 360.00
7 Paint bumper and fender | 6.0 | 75.00 | 450.00
8 Paint materials | 1 | 195.00 | 195.00
9 Headlamp calibration | 1 | 90.00 | 90.00
10 Wheel alignment | 1 | 65.00 | 65.00
TOTAL NET |  |  | 3,078.00`,
    ]);
    expect(est.items.map((i) => [i.desc, i.kind, i.hours, i.total])).toEqual([
      ['Front bumper cover', 'part', null, 465],
      ['Left LED headlamp', 'part', null, 720],
      ['Left fender', 'part', null, 285],
      ['Left lower control arm', 'part', null, 160],
      ['Replace bumper and headlamp', 'labour', 4, 288],
      ['Replace fender and control arm', 'labour', 5, 360],
      ['Paint bumper and fender', 'paint', 6, 450],
      ['Paint materials', 'material', null, 195],
      ['Headlamp calibration', 'other', null, 90],
      ['Wheel alignment', 'other', null, 65],
    ]);
    expect(est).toMatchObject({ currency: 'USD', labourRate: 72, paintRate: 75, statedTotal: 3078 });
    expect(netOfItems(est)).toBe(3078);
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

describe('workshop quote', () => {
  const insurer = sampleEstimate();
  const garage = sampleQuote();
  const cmp = compareQuote(insurer, garage);

  it('compares by category and the rows add up to the totals', () => {
    expect(cmp).toMatchObject({ insurerNet: 5437.5, garageNet: 10520, gap: 5082.5 });
    expect(cmp.rows.map((r) => [r.kind, r.insurer, r.garage, r.gap])).toEqual([
      ['part', 5310, 6510, 1200],
      ['labour', 712.5, 1620, 907.5],
      ['paint', 520, 1140, 620],
      ['material', 610, 780, 170],
      ['other', 0, 470, 470],
      ['deduction', -1715, 0, 1715],
    ]);
    expect(cmp.rows.reduce((s, r) => s + r.gap, 0)).toBe(cmp.gap);
    expect(cmp.rows[1]).toMatchObject({ insurerHours: 7.5, garageHours: 9, insurerRate: 95, garageRate: 180 });
  });

  it('lists the work only the quote has', () => {
    expect(cmp.extra.map((i) => i.total)).toEqual([250, 220]);
  });

  it('does not call a calibration left out when the estimate aims the headlamps', () => {
    const line = (desc: string, kind: 'labour' | 'other', total: number) => ({ ...insurer.items[0], desc, kind, total, hours: null, rate: null });
    const withAim = { ...insurer, items: [line('Aim headlamps', 'labour', 20)] };
    const without = { ...insurer, items: [line('Replace headlamp', 'labour', 20)] };
    const quote = { ...garage, items: [line('Headlamp calibration', 'other', 90)] };
    expect(compareQuote(withAim, quote).extra).toHaveLength(0);
    expect(compareQuote(without, quote).extra).toHaveLength(1);
  });

  it('replaces the rate and deduction rules with the quote difference', () => {
    const settings = defaultSettings('PLN', 23);
    const findings = audit(insurer, settings, cmp);
    const ids = findings.map((f) => f.id);
    expect(ids).toContain('quote');
    expect(ids).not.toContain('labourRate');
    expect(ids).not.toContain('paintRate');
    expect(ids).not.toContain('deductions');
    const totals = tierTotals(findings, new Set(ids));
    // The claimant ends up with the gross quote less the net estimate already offered.
    expect(totals.cautious).toBe(totals.optimistic);
    // Each VAT figure in the letter is rounded on its own, so the sum may be a cent off.
    expect(Math.abs(totals.realistic - (10520 * 1.23 - 5437.5))).toBeLessThan(0.02);
  });

  it('keeps the usual rules when the quote is not higher', () => {
    const findings = audit(insurer, defaultSettings('PLN', 23), compareQuote(insurer, insurer));
    expect(findings.map((f) => f.id)).toContain('labourRate');
    expect(findings.map((f) => f.id)).not.toContain('quote');
  });

  it('writes the breakdown into the letter and the letter passes its own check', () => {
    const findings = audit(insurer, defaultSettings('PLN', 23), cmp);
    const letter = draftLetter(insurer, findings, new Set(findings.map((f) => f.id)), 'realistic', 'en', cmp);
    expect(letter).toContain('It comes to PLN 10,520.00 net, while the estimate comes to PLN 5,437.50. Difference: PLN 5,082.50.');
    expect(letter).toContain('Labour: the estimate allows PLN 712.50 (7.5 hours at PLN 95.00 per hour); the quote allows PLN 1,620.00 (9 hours at PLN 180.00 per hour).');
    expect(letter).toContain('Deductions: the estimate deducts PLN 1,715.00; the quote has no deductions.');
    expect(letter).toContain('Headlamp calibration (PLN 250.00)');
    expect(verifyRewrite(letter, letter).ok).toBe(true);
    const pl = draftLetter(insurer, findings, new Set(findings.map((f) => f.id)), 'realistic', 'pl', cmp);
    expect(pl).toContain('Potrącenia: kosztorys potrąca 1715,00 zł; wycena warsztatu nie zawiera potrąceń.');
  });

  it('ends a section at a heading it does not know', () => {
    const est = parseTranscription(['PAINT\nPaint bumper | 6.0 | 75.00 | 450.00\nEXTRA ITEMS\nWheel alignment | 1 | 65.00 | 65.00\nADDITIONAL WORK\nHeadlamp calibration | 1 | 90.00 | 90.00'], 'GBP');
    expect(est.items.map((i) => i.kind)).toEqual(['paint', 'other', 'other']);
  });
});
});

describe('totals block of real estimating systems', () => {
  it('reads a CCC-style block: hours, rates and the total', () => {
    const text = `Line | Oper | Description | Part Number | Qty | Extended | Labor | Paint
5 | Repl | Bumper cover w/park sensor | 1 | 890.00 | Incl. | 3.2
6 | Add for Clear Coat | 1.3
SUBTOTALS | 1,337.00 | 8.5 | 5.2
ESTIMATE TOTALS
Category | Basis | Rate | Cost $
Parts | 1,325.00
Body Labor | 7.5 hrs | @ | $ 48.00 /hr | 360.00
Paint Labor | 5.2 hrs | @ | $ 48.00 /hr | 249.60
Mechanical Labor | 1.0 hrs | @ | $ 110.00 /hr | 110.00
Paint Supplies | 5.2 hrs | @ | $ 30.00 /hr | 156.00
Miscellaneous | 12.00
Subtotal | 2,212.60
Sales Tax | $ 1,481.00 @ 7.0000 % | 103.67
Grand Total | 2,316.27
Deductible | 500.00
INSURANCE PAY | 1,816.27`;
    const out = parseDocumentText([text]);
    expect(out.from).toBe('summary');
    expect(out.taxRatePct).toBe(7);
    expect(out.estimate).toMatchObject({ currency: 'USD', labourRate: 48, paintRate: 48, statedTotal: 2212.6 });
    expect(out.estimate.items.map((i) => [i.desc, i.kind, i.hours, i.total])).toEqual([
      ['Parts', 'part', null, 1325],
      ['Body Labor', 'labour', 7.5, 360],
      ['Paint Labor', 'paint', 5.2, 249.6],
      ['Mechanical Labor', 'labour', 1, 110],
      ['Paint Supplies', 'material', 5.2, 156],
      ['Miscellaneous', 'other', null, 12],
    ]);
    expect(netOfItems(out.estimate)).toBe(2212.6);
  });

  it('stops at the grand total and ignores a supplement summary further down', () => {
    const out = parseDocumentText([`ESTIMATE TOTALS
Parts | 1,325.00
Body Labor | 7.5 hrs | @ | $ 48.00 /hr | 360.00
Paint Labor | 5.2 hrs | @ | $ 48.00 /hr | 249.60
Subtotal | 1,934.60
Grand Total | 1,934.60
Deductible | 500.00
RATE CHANGES
Mechanical Labor | 0.5 hrs | @ | $ 70.00 /hr | 35.00
SUPPLEMENT TOTALS
Parts | 400.00
Body Labor | 2.3 hrs | @ | $ 48.00 /hr | 110.40
Grand Total | 510.40`]);
    expect(out.estimate.items.map((i) => i.total)).toEqual([1325, 360, 249.6]);
    expect(out.estimate.statedTotal).toBe(1934.6);
  });

  it('reads a Mitchell-style block with labour units and rates', () => {
    const out = parseDocumentText([`Estimate Totals
I. | Labor Subtotals | Units | Rate | Amount | Amount | Totals | II. | Part Replacement Summary | Amount
Body | 15.7 | 46.00 | 0.00 | 0.00 | 722.20 | T | Taxable Parts | 416.91
Bdy-S | 1.5 | 46.00 | 0.00 | 0.00 | 69.00 | T | Sales Tax | @ | 9.550% | 39.81
Refinish | 8.1 | 46.00 | 0.00 | 10.00 | 382.60 | T
Mechanical | 9.7 | 65.00 | 0.00 | 0.00 | 630.50 | T | Total Replacement Parts Amount | 456.72
Taxable Labor | 1,804.30
Labor Tax | @ | 9.550 % | 172.31
Labor Summary | 35.0 | 1,976.61
III. | Additional Costs | Amount | IV. | Adjustments | Amount
Taxable Costs | 278.40 | Insurance Deductible | 500.00-
Total Additional Costs | 304.99
I. | Total Labor: | 1,976.61
II. | Total Replacement Parts: | 456.72
III. | Total Additional Costs: | 304.99
Gross Total: | 2,738.32
IV. | Total Adjustments: | 500.00-
Net Total: | 2,238.32`], 'USD');
    expect(out.from).toBe('summary');
    expect(out.estimate.items.map((i) => [i.desc, i.kind, i.hours, i.unitPrice, i.total])).toEqual([
      ['Body', 'labour', 15.7, 46, 722.2],
      ['Bdy-S', 'labour', 1.5, 46, 69],
      ['Refinish', 'paint', 8.1, 46, 382.6],
      ['Mechanical', 'labour', 9.7, 65, 630.5],
      ['Total Replacement Parts', 'part', null, null, 456.72],
      ['Total Additional Costs', 'other', null, null, 304.99],
    ]);
    expect(out.estimate).toMatchObject({ labourRate: 46, paintRate: 46 });
    // The grand total is the rows plus labour tax, so nothing is reported as missing.
    expect(sumMismatch(out.estimate)).toBeNull();
  });

  it('does not call mechanical work underpaid because bodywork is', () => {
    const { estimate } = parseDocumentText([`Parts | 1,325.00
Body Labor | 7.5 hrs | @ | $ 48.00 /hr | 360.00
Mechanical Labor | 1.0 hrs | @ | $ 110.00 /hr | 110.00
Subtotal | 1,795.00`]);
    const settings = { ...defaultSettings('USD', 0), refRates: { low: 60, mid: 90, high: 140 } };
    const labour = audit(estimate, settings).find((f) => f.id === 'labourRate')!;
    // Bodywork: 7.5 h at 48. Mechanical: 1 h at 110, above the low and typical rates.
    expect(labour.amounts).toEqual({ cautious: 90, realistic: 315, optimistic: 720 });
  });

  it('reads the Audatex final calculation, printed letter by letter', () => {
    const text = `K A L K U L A C J A K O Ń C O W A | PLN | PLN
R O B O C I Z N A BAZA CZASOWA | 10 JC = 1 RBG
RAZEM | 99 JC X | 70.00 PLN/RBG | 693.00
RAZEM ROBOCIZNA ............................ | 693.00
L A K I E R O W A N I E
KOSZTY ROBOCIZNY | 378.00
KOSZTY MATERIAŁU | 634.51
RAZEM LAKIEROWANIE ......................... | 1 012.51
C Z Ę Ś C I Z A M I E N N E | 2 277.00
NORMALIA ( 2.0%) | 45.54
RAZEM CZĘŚCI ZAMIENNE ...................... | 2 322.54
K O S Z T Y N A P R A W Y BEZ VAT .......... | 4 028.05
VAT 23.00 % | 926.45
K O S Z T Y N A P R A W Y Z VAT ............ | 4 954.50`;
    const out = parseDocumentText([text]);
    expect(out.from).toBe('summary');
    expect(out.taxRatePct).toBe(23);
    expect(out.estimate).toMatchObject({ currency: 'PLN', labourRate: 70, statedTotal: 4028.05 });
    expect(out.estimate.items.map((i) => [i.kind, i.hours, i.total])).toEqual([
      ['labour', 9.9, 693],
      ['paint', null, 378],
      ['material', null, 634.51],
      ['part', null, 2322.54],
    ]);
    expect(netOfItems(out.estimate)).toBe(4028.05);
  });

  it('leaves a plain table to the row parser', () => {
    const out = parseDocumentText([`No. | Description | Part type | Qty / hours | Unit price | Net GBP
PARTS
1 | Front bumper | Non-OEM | 1 | 310.00 | 310.00
LABOUR
5 | Replace bumper and headlamp | 3.4 | 38.00 | 129.20
PAINT
8 | Paint materials | 1 | 150.00 | 150.00
TOTAL REPAIR COST NET | 589.20`]);
    expect(out.from).toBe('rows');
    expect(out.estimate.items.map((i) => i.kind)).toEqual(['part', 'labour', 'material']);
    expect(out.estimate.statedTotal).toBe(589.2);
  });

  it('builds lines and cells from the text runs of a PDF page', () => {
    const run = (str: string, x: number, y: number) => ({ str, x, y, width: str.length * 4.4, height: 8 });
    const lines = layoutLines([run('Body Labor', 40, 500), run('5.7 hrs', 200, 500), run('@', 250, 500.4), run('$ 52.00 /hr', 290, 500), run('296.40', 400, 500), run('ESTIMATE', 40, 520), run('TOTALS', 78, 520), run('Parts', 40, 510), run('2,166.78', 392, 510)]);
    expect(lines).toEqual(['ESTIMATE TOTALS', 'Parts | 2,166.78', 'Body Labor | 5.7 hrs | @ | $ 52.00 /hr | 296.40']);
    expect(hasTextLayer(lines)).toBe(false);
  });
});

describe('plain-language explanation', () => {
  const estimate = sampleEstimate();
  const prompt = explainPrompt(estimate, 'en');

  it('puts only the lines into the prompt', () => {
    expect(prompt).toContain('Body and mechanical labour allowed: 7.5 hours at PLN\u00a095.00 per hour, PLN\u00a0712.50');
    expect(prompt).toContain('Amount the insurer took off, under the heading "Amortyzacja części 30% / Parts depreciation 30%; Rabat na materiał lakierniczy 20% / Paint material discount 20%": PLN\u00a01,715.00');
    expect(prompt).toContain('What the estimate comes to in the end, after the amounts taken off: PLN\u00a05,437.50');
    expect(prompt).not.toMatch(/Jan|VIN|DW 12345/);
  });

  it('accepts figures from the estimate and catches an invented one', () => {
    expect(inventedFigure(prompt, 'The insurer allows 7.5 hours of labour at PLN 95 per hour, PLN 712.50, and takes PLN 1,715.00 off the payout.')).toBeNull();
    expect(inventedFigure(prompt, 'The repair should cost about PLN 7,200.')).toBe('7,200');
  });
});

describe('rewording the letter', () => {
  const estimate = sampleEstimate();
  const findings = audit(estimate, defaultSettings('PLN', 23));
  const parts = letterParts(estimate, findings, new Set(findings.map((f) => f.id)), 'realistic', 'en');

  it('gives the model the two prose paragraphs and none of the amounts', () => {
    const prompt = polishPrompt(parts, 'en');
    expect(prompt).toContain('I have reviewed the repair estimate');
    expect(prompt).toContain('within 14 days');
    expect(prompt).not.toMatch(/PLN|787|Labour rate/);
    expect(joinLetter(parts)).toBe(draftLetter(estimate, findings, new Set(findings.map((f) => f.id)), 'realistic', 'en'));
  });

  it('puts two good paragraphs into the letter and leaves the points alone', () => {
    const out = applyPolish(parts, 'I have gone through the estimate you issued for this claim and I cannot accept it as full settlement, for the reasons below.\n---\nPlease pay this amount within 14 days or tell me in writing why you will not. I may have the car assessed independently.');
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.changed).toBe(true);
      expect(applyPolish(parts, `${parts.open}\n\n---\n\n${parts.close}`)).toMatchObject({ ok: true, changed: false });
      expect(polishPrompt(parts, 'en', 'shorter')).toContain('at most two sentences each');
      expect(out.parts.middle).toBe(parts.middle);
      expect(joinLetter(out.parts)).toContain('I have gone through the estimate');
    }
  });

  it('rejects an answer with a changed deadline, a new amount or the wrong shape', () => {
    expect(applyPolish(parts, 'I do not accept the estimate as full settlement for the reasons below.\n---\nPlease pay within 7 days or explain in writing why you refuse.')).toMatchObject({ ok: false });
    expect(applyPolish(parts, 'I do not accept the estimate; you owe me 5,000 more as shown below.\n---\nPlease pay within 14 days or explain in writing why you refuse.')).toMatchObject({ ok: false, reason: 'number_added' });
    // Real on-device output: blanks to fill in, a currency sign and the deadline in words.
    expect(
      applyPolish(parts, 'I have reviewed the repair estimate issued for claim number ______. I do not accept this as full settlement due to discrepancies in the quoted repair costs.\n\n---\n\nPlease remit the remaining balance of $_______ within fourteen days. If you object to this amount, please provide a written explanation.'),
    ).toMatchObject({ ok: false });
    expect(applyPolish(parts, 'I have reviewed the estimate and I do not accept it as full settlement, for the reasons below.\n---\nPlease pay within fourteen days or explain in writing why you refuse.')).toMatchObject({ ok: false, reason: 'number_missing', value: '14' });
    expect(applyPolish(parts, 'Dear insurer, here is one long paragraph without the separator you were asked for, within 14 days.')).toMatchObject({ ok: false, reason: 'shape' });
  });
});

describe('remote settings', () => {
  it('takes a sound value and ignores a broken one', async () => {
    const { applyRemote, tuning } = await import('./ai');
    applyRemote('gemini-3.5-flash', 120);
    expect(tuning).toEqual({ cloudModel: 'gemini-3.5-flash', cloudModelBackup: 'gemini-3.1-flash-lite', deviceTimeoutS: 120 });
    applyRemote('', 5);
    applyRemote('drop table', Number.NaN, 'also; bad');
    expect(tuning).toEqual({ cloudModel: 'gemini-3.5-flash', cloudModelBackup: 'gemini-3.1-flash-lite', deviceTimeoutS: 120 });
    applyRemote('gemini-3.5-flash-lite', 90, 'gemini-3.1-flash-lite');
  });
});

describe('cloud model with a daily allowance', () => {
  it('tells an exhausted allowance from other failures', async () => {
    const { isQuotaError } = await import('./ai');
    expect(isQuotaError(new Error('[429 ] You exceeded your current quota, please check your plan'))).toBe(true);
    expect(isQuotaError(new Error('RESOURCE_EXHAUSTED: Resource has been exhausted'))).toBe(true);
    expect(isQuotaError(new Error('Failed to fetch'))).toBe(false);
    expect(isQuotaError(new Error('App Check token is invalid'))).toBe(false);
  });

  it('sends the request to the backup model when the first one is used up', async () => {
    const { withBackupModel, tuning } = await import('./ai');
    const asked: string[] = [];
    const answer = await withBackupModel(async (name) => {
      asked.push(name);
      if (name === tuning.cloudModel) throw new Error('429 quota exceeded');
      return 'ok';
    });
    expect(answer).toBe('ok');
    expect(asked).toEqual([tuning.cloudModel, tuning.cloudModelBackup]);
  });

  it('says so when both models are used up, and does not retry other failures', async () => {
    const { withBackupModel, CloudBusyError } = await import('./ai');
    await expect(withBackupModel(async () => { throw new Error('RESOURCE_EXHAUSTED'); })).rejects.toBeInstanceOf(CloudBusyError);
    let calls = 0;
    await expect(withBackupModel(async () => { calls++; throw new Error('Failed to fetch'); })).rejects.toThrow('Failed to fetch');
    expect(calls).toBe(1);
  });
});

describe('letter rewording keeps the point of the letter', () => {
  const estimate = sampleEstimate();
  const findings = audit(estimate, defaultSettings('PLN', 23));
  const parts = letterParts(estimate, findings, new Set(findings.map((f) => f.id)), 'realistic', 'en');

  it('rejects what Gemini Nano wrote on 27 Nov: a numbered opening and a closing that no longer asks for payment', () => {
    const numbered = '1. I have reviewed the repair estimate issued for this claim. I must inform you that I do not accept it as complete settlement because it insufficiently addresses the necessary repairs.\n---\nPlease pay the amount above within 14 days, or explain your refusal in writing.';
    expect(applyPolish(parts, numbered)).toMatchObject({ ok: false, reason: 'shape' });
    const soft = 'I have reviewed the repair estimate issued for this claim and I do not accept it as complete settlement.\n---\nPlease confirm your understanding of this matter within 14 days, and provide a written explanation of any discrepancy.';
    expect(applyPolish(parts, soft)).toMatchObject({ ok: false, reason: 'meaning' });
    const agreeing = 'Thank you for the repair estimate, which I have reviewed with interest.\n---\nPlease pay the amount above within 14 days, or explain in writing why you refuse.';
    expect(applyPolish(parts, agreeing)).toMatchObject({ ok: false, reason: 'meaning' });
  });

  it('accepts the friendlier version Gemini Nano wrote, which still refuses and still asks for payment', () => {
    const friendly = "I've carefully reviewed the repair estimate provided for this claim. While I appreciate you taking the time to provide it, I haven't yet been able to fully accept it as a complete settlement, as it doesn't account for certain repair costs.\n\n---\n\nPlease remit payment for the remaining amount within 14 days, or please provide a detailed written explanation, outlining item by item why a different amount is necessary.";
    expect(applyPolish(parts, friendly)).toMatchObject({ ok: true, changed: true });
  });

  it('accepts a firmer version that keeps both', () => {
    const firm = 'I have reviewed the repair estimate for this claim and I do not accept it as full settlement: it understates the cost of the repair.\n---\nI expect payment of the amount above within 14 days, or a written explanation of your refusal, item by item.';
    expect(applyPolish(parts, firm)).toMatchObject({ ok: true, changed: true });
  });
});
