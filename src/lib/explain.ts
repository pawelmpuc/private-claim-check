import { netOfItems } from './audit';
import { money } from './letter';
import type { Estimate, Lang } from './types';

/**
 * Builds the prompt for the plain-language explanation. Only the lines of the estimate
 * go into it: descriptions, hours and amounts. No name, address, plate, VIN or claim
 * number is part of an Estimate, so none can reach a model through this prompt.
 */
export function explainPrompt(estimate: Estimate, lang: Lang): string {
  const fmt = (n: number) => money(n, estimate.currency, lang);
  const of = (kind: string) => estimate.items.filter((i) => i.kind === kind);
  const sum = (kind: string) => of(kind).reduce((t, i) => t + Math.abs(i.total ?? 0), 0);
  const hours = (kind: string) => Math.round(of(kind).reduce((t, i) => t + (i.hours ?? 0), 0) * 100) / 100;
  const names = (kind: string) => of(kind).map((i) => i.desc).join('; ');
  const quality = (q: string) => (q === 'oem' ? ' (original)' : q === 'used' ? ' (used)' : q === 'alternative' ? ' (non-original)' : '');
  // With a totals-block estimate the parts are one line; the detail lines say what they are.
  const parts = estimate.details?.length ? estimate.details.join('; ') : of('part').map((i) => `${i.desc}${quality(i.partQuality)}`).join('; ');
  const timed = (label: string, kind: 'labour' | 'paint', rate: number | null) =>
    sum(kind) > 0 ? `${label}: ${hours(kind) > 0 ? `${hours(kind)} hours` : ''}${hours(kind) > 0 && rate != null ? ` at ${fmt(rate)} per hour` : ''}${hours(kind) > 0 ? ', ' : ''}${fmt(sum(kind))}` : '';
  // The facts are worked out here, so the model only has to put them into sentences.
  const facts = [
    parts ? `Parts and jobs named on the estimate (no single prices are given to you): ${parts}` : '',
    sum('part') > 0 ? `Parts cost together: ${fmt(sum('part'))}` : '',
    timed('Body and mechanical labour allowed', 'labour', estimate.labourRate),
    timed('Paint labour allowed', 'paint', estimate.paintRate),
    sum('material') > 0 ? `Paint materials: ${fmt(sum('material'))}` : '',
    sum('other') > 0 ? `Other items (${names('other')}): ${fmt(sum('other'))}` : '',
    sum('deduction') > 0 ? `Amount the insurer took off, under the heading "${names('deduction')}": ${fmt(sum('deduction'))}` : 'Amount the insurer took off: nothing',
    `Total of the estimate after deductions: ${fmt(netOfItems(estimate))}`,
  ].filter(Boolean);
  const language = lang === 'pl' ? 'Polish' : 'English';
  return `Explain a car repair estimate from an insurance company to the car owner in plain ${language}. Write one short sentence for each fact below, in the same order.
Rules:
- Use only the figures in the facts and copy them exactly.
- Do not calculate anything and do not combine two facts into a new figure.
- Name the parts and jobs in one sentence, without a price for any single one.
- An amount taken off is money the insurer cut from the payout. Its heading is the insurer's name for the cut, not the name of a company.
- Do not give advice and do not judge whether the estimate is fair.
- No headings and no lists.

FACTS:
${facts.join('\n')}`;
}

const NUMBER = /\d+(?:[   .,]\d+)*/g;
const digits = (text: string) => (text.match(NUMBER) ?? []).map((raw) => ({ raw, digits: raw.replace(/\D/g, '') }));

/**
 * Returns the first figure of the explanation that the prompt did not contain, or null.
 * One- and two-digit numbers are let through: a model may count the lines or the sentences.
 */
export function inventedFigure(prompt: string, explanation: string): string | null {
  const allowed = new Set(digits(prompt).map((n) => n.digits.replace(/0+$/, '')));
  const bad = digits(explanation).find((n) => n.digits.length >= 3 && !allowed.has(n.digits.replace(/0+$/, '')));
  return bad ? bad.raw : null;
}
