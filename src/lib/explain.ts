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
  const kinds: Record<string, string> = { part: 'part', labour: 'labour', paint: 'paint labour', material: 'paint materials', deduction: 'deduction', other: 'other' };
  const lines = estimate.items.map((i) => {
    const hours = i.hours != null ? `, ${i.hours} hours` : '';
    const quality = i.kind === 'part' && i.partQuality !== 'unknown' ? `, ${i.partQuality === 'oem' ? 'original part' : i.partQuality === 'used' ? 'used part' : 'non-original part'}` : '';
    return `- ${i.desc} (${kinds[i.kind]}${quality}${hours}): ${i.kind === 'deduction' ? 'minus ' : ''}${fmt(Math.abs(i.total ?? 0))}`;
  });
  const sum = (kind: string) => estimate.items.filter((i) => i.kind === kind).reduce((t, i) => t + Math.abs(i.total ?? 0), 0);
  const hoursOf = (kind: string) => estimate.items.filter((i) => i.kind === kind).reduce((t, i) => t + (i.hours ?? 0), 0);
  const round = (n: number) => Math.round(n * 100) / 100;
  // Subtotals are given so that the model does not have to add anything up itself.
  const facts = [
    sum('part') > 0 ? `All parts together: ${fmt(sum('part'))}` : '',
    hoursOf('labour') > 0 ? `All labour together: ${round(hoursOf('labour'))} hours, ${fmt(sum('labour'))}` : '',
    hoursOf('paint') > 0 ? `All paint labour together: ${round(hoursOf('paint'))} hours, ${fmt(sum('paint'))}` : '',
    sum('deduction') > 0 ? `All deductions together: minus ${fmt(sum('deduction'))}` : '',
    estimate.labourRate != null ? `Labour rate: ${fmt(estimate.labourRate)} per hour` : '',
    estimate.paintRate != null ? `Paint labour rate: ${fmt(estimate.paintRate)} per hour` : '',
    `Total of the lines: ${fmt(netOfItems(estimate))}`,
  ].filter(Boolean);
  const language = lang === 'pl' ? 'Polish' : 'English';
  return `Below are the lines of a car repair estimate written by an insurance company. Explain the estimate to the car owner in plain ${language}, in 4 to 6 short sentences.
Say what is replaced, what is repaired and what is painted, how many hours of work are allowed and at what hourly rate, and what was deducted.
Rules:
- Use only the figures listed below and copy them exactly.
- Do not calculate new figures.
- Do not give advice and do not judge whether the estimate is fair.
- No headings and no lists.

ESTIMATE:
${lines.join('\n')}
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
