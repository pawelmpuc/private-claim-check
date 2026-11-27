import type { AuditSettings, Estimate, EstimateItem, Finding, RefRates, Tier, Tiered } from './types';
import type { Comparison } from './compare';

/**
 * Example hourly rates used only as a starting point. They are not market data:
 * the user is asked to replace them with rates quoted by workshops nearby.
 */
export const EXAMPLE_REF_RATES: Record<string, RefRates> = {
  PLN: { low: 150, mid: 200, high: 280 },
  EUR: { low: 60, mid: 85, high: 120 },
  GBP: { low: 55, mid: 75, high: 110 },
  USD: { low: 60, mid: 90, high: 140 },
};

export const TIERS: Tier[] = ['cautious', 'realistic', 'optimistic'];

export function defaultSettings(currency: string, vatRatePct = 20): AuditSettings {
  return {
    refRates: EXAMPLE_REF_RATES[currency] ?? EXAMPLE_REF_RATES.EUR,
    totalIsNet: true,
    claimantDeductsVat: false,
    vatRatePct,
  };
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function itemTotal(item: EstimateItem): number {
  if (item.total != null) return item.total;
  if (item.unitPrice != null) return item.unitPrice * (item.qty ?? 1);
  return 0;
}

function sumHours(items: EstimateItem[]): number {
  return items.reduce((s, i) => s + (i.hours ?? 0), 0);
}

/** Rate printed on the estimate, or the rate implied by lines that show both hours and a total. */
function effectiveRate(printed: number | null, items: EstimateItem[]): number | null {
  if (printed != null && printed > 0) return printed;
  const priced = items.filter((i) => (i.hours ?? 0) > 0 && i.total != null);
  const hours = sumHours(priced);
  if (hours <= 0) return null;
  return round2(priced.reduce((s, i) => s + (i.total ?? 0), 0) / hours);
}

function rateFinding(
  id: 'labourRate' | 'paintRate',
  printed: number | null,
  items: EstimateItem[],
  ref: RefRates,
): Finding | null {
  const hours = sumHours(items);
  const rate = effectiveRate(printed, items);
  if (hours <= 0 || rate == null) return null;
  // A line that prints its own amount is compared at its own hourly rate, so mechanical
  // work billed at a higher rate than bodywork is not counted as underpaid.
  const gap = (target: number) =>
    round2(
      items.reduce((s, i) => {
        const h = i.hours ?? 0;
        if (h <= 0) return s;
        const own = i.total != null ? Math.max(rate, i.total / h) : rate;
        return s + Math.max(0, target - own) * h;
      }, 0),
    );
  const amounts: Tiered = { cautious: gap(ref.low), realistic: gap(ref.mid), optimistic: gap(ref.high) };
  if (amounts.optimistic <= 0) return null;
  return {
    id,
    amounts,
    params: { rate, hours: round2(hours), low: ref.low, mid: ref.mid, high: ref.high },
    itemIds: items.map((i) => i.id),
  };
}

const ADAS_PART = /windscreen|windshield|szyb[ay] czo|radar|camera|kamer|sensor|czujnik|bumper|zderzak|lusterk|mirror|headl|reflektor/i;
const CALIBRATION = /calibrat|kalibrac/i;
const SUSPENSION_PART = /wahacz|control arm|zwrotnic|knuckle|amortyzator|shock abs|strut|dr[aą][zż]ek|tie rod|suspension|zawiesz|wishbone|piast|hub/i;
const ALIGNMENT = /geometri|alignment|zbie[zż]no/i;

export function netOfItems(estimate: Estimate): number {
  return round2(
    estimate.items.reduce((s, i) => {
      const v = Math.abs(itemTotal(i));
      return i.kind === 'deduction' ? s - v : s + v;
    }, 0),
  );
}

/** The gap between the lines and the printed total, when it is too large to be rounding. Null when they agree. */
export function sumMismatch(estimate: Estimate): { lines: number; stated: number } | null {
  if (estimate.statedTotal == null) return null;
  const lines = netOfItems(estimate);
  return Math.abs(lines - estimate.statedTotal) > Math.max(1, estimate.statedTotal * 0.01) ? { lines, stated: estimate.statedTotal } : null;
}

/**
 * With a workshop quote that is higher than the estimate, the difference between the two
 * replaces the rate and deduction rules: the quote already prices them.
 */
export function audit(estimate: Estimate, settings: AuditSettings, comparison: Comparison | null = null): Finding[] {
  const findings: Finding[] = [];
  const { items } = estimate;
  const byQuote = comparison != null && comparison.gap > 0;
  if (comparison && byQuote) {
    const gap = comparison.gap;
    findings.push({
      id: 'quote',
      amounts: { cautious: gap, realistic: gap, optimistic: gap },
      params: { insurer: comparison.insurerNet, garage: comparison.garageNet },
      itemIds: [],
    });
  }

  const labour = byQuote ? null : rateFinding('labourRate', estimate.labourRate, items.filter((i) => i.kind === 'labour'), settings.refRates);
  if (labour) findings.push(labour);

  const paint = byQuote ? null : rateFinding('paintRate', estimate.paintRate, items.filter((i) => i.kind === 'paint'), settings.refRates);
  if (paint) findings.push(paint);

  const deductions = items.filter((i) => i.kind === 'deduction');
  const deducted = round2(deductions.reduce((s, i) => s + Math.abs(itemTotal(i)), 0));
  if (deducted > 0 && !byQuote) {
    findings.push({
      id: 'deductions',
      amounts: { cautious: deducted, realistic: deducted, optimistic: deducted },
      params: { count: deductions.length },
      itemIds: deductions.map((i) => i.id),
    });
  }

  if (settings.totalIsNet && !settings.claimantDeductsVat && settings.vatRatePct > 0) {
    const base = estimate.statedTotal ?? netOfItems(estimate);
    if (base > 0) {
      // VAT on the printed total. VAT on the other selected shortfalls is added in tierTotals.
      const vat = round2((base * settings.vatRatePct) / 100);
      findings.push({
        id: 'vat',
        amounts: { cautious: vat, realistic: vat, optimistic: vat },
        params: { rate: settings.vatRatePct, base: round2(base) },
        itemIds: [],
      });
    }
  }

  const alternative = items.filter((i) => i.kind === 'part' && (i.partQuality === 'alternative' || i.partQuality === 'used'));
  if (alternative.length > 0) {
    findings.push({ id: 'alternativeParts', amounts: null, params: { count: alternative.length }, itemIds: alternative.map((i) => i.id) });
  }

  const adas = items.filter((i) => i.kind === 'part' && ADAS_PART.test(i.desc));
  if (adas.length > 0 && !items.some((i) => CALIBRATION.test(i.desc))) {
    findings.push({ id: 'missingCalibration', amounts: null, params: { count: adas.length }, itemIds: adas.map((i) => i.id) });
  }

  const suspension = items.filter((i) => i.kind === 'part' && SUSPENSION_PART.test(i.desc));
  if (suspension.length > 0 && !items.some((i) => ALIGNMENT.test(i.desc))) {
    findings.push({ id: 'missingAlignment', amounts: null, params: { count: suspension.length }, itemIds: suspension.map((i) => i.id) });
  }

  if (estimate.statedTotal != null) {
    const net = netOfItems(estimate);
    const diff = round2(net - estimate.statedTotal);
    if (Math.abs(diff) > Math.max(1, estimate.statedTotal * 0.01)) {
      findings.push({ id: 'arithmetic', amounts: null, params: { lines: net, stated: estimate.statedTotal, diff }, itemIds: [] });
    }
  }

  return findings;
}

/** VAT that applies to the other selected shortfalls, per tier. Zero unless the VAT finding is selected. */
export function vatOnUplift(findings: Finding[], selected: Set<string>): Tiered {
  const out: Tiered = { cautious: 0, realistic: 0, optimistic: 0 };
  const vat = findings.find((f) => f.id === 'vat');
  if (!vat || !selected.has('vat')) return out;
  const rate = Number(vat.params.rate) / 100;
  for (const tier of TIERS) {
    const uplift = findings.reduce((s, f) => (f.amounts && f.id !== 'vat' && selected.has(f.id) ? s + f.amounts[tier] : s), 0);
    out[tier] = round2(uplift * rate);
  }
  return out;
}

export function tierTotals(findings: Finding[], selected: Set<string>): Tiered {
  const total = vatOnUplift(findings, selected);
  for (const f of findings) {
    if (!f.amounts || !selected.has(f.id)) continue;
    for (const tier of TIERS) total[tier] = round2(total[tier] + f.amounts[tier]);
  }
  return total;
}
