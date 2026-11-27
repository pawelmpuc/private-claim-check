import { vatOnUplift } from './audit';
import type { Comparison, GapRow } from './compare';
import type { Estimate, Finding, Lang, Tier } from './types';

export interface LetterDetails {
  name: string;
  insurer: string;
  claimNumber: string;
}

const LOCALE: Record<Lang, string> = { en: 'en-GB', pl: 'pl-PL' };

export function money(amount: number, currency: string, lang: Lang): string {
  try {
    return new Intl.NumberFormat(LOCALE[lang], { style: 'currency', currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

const num = (n: string | number, lang: Lang) => new Intl.NumberFormat(LOCALE[lang], { maximumFractionDigits: 2 }).format(Number(n));

type Fmt = (n: string | number) => string;
type Lines = Record<Finding['id'], (f: Finding, amount: string, tierRate: string, m: Fmt) => string>;

const POINTS: Record<Lang, Lines> = {
  en: {
    quote: (f, a, _r, m) =>
      `Workshop quote. I obtained a quote for the same repair from a repair workshop and enclose a copy. It comes to ${m(f.params.garage)} net, while the estimate comes to ${m(f.params.insurer)}. Difference: ${a}.`,
    labourRate: (f, a, r, m) =>
      `Labour rate. The estimate prices ${num(f.params.hours, 'en')} hours of body and mechanical work at ${m(f.params.rate)} per hour. Workshops in my area charge ${r} per hour for this work. Difference: ${a}.`,
    paintRate: (f, a, r, m) =>
      `Paint labour rate. The estimate prices ${num(f.params.hours, 'en')} hours of paint work at ${m(f.params.rate)} per hour, against a local rate of ${r} per hour. Difference: ${a}.`,
    deductions: (f, a) =>
      `Deductions. The estimate lowers the payout through ${f.params.count} deduction line(s) such as depreciation or discounts. I have not been shown that these discounts are available to me or that new parts would raise the value of the vehicle. Amount deducted: ${a}.`,
    vat: (f, a) =>
      `VAT. The estimate is calculated without VAT. I cannot reclaim VAT, so the repair will cost me the gross amount. VAT at ${num(f.params.rate, 'en')}% on the estimate total: ${a}.`,
    alternativeParts: (f) =>
      `The estimate prices ${f.params.count} part(s) as non-original or used parts. Please state the price of the original manufacturer parts and explain why they were not used.`,
    missingCalibration: () =>
      `The estimate replaces parts that usually carry or sit next to sensors, cameras or lamps, yet it includes no calibration. Please confirm whether calibration is needed and add it to the estimate.`,
    missingAlignment: () =>
      `The estimate replaces suspension or steering parts but includes no wheel alignment. Please add it or explain why it is not needed.`,
    arithmetic: (f, _a, _r, m) =>
      `The lines of the estimate add up to ${m(f.params.lines)}, while the printed total is ${m(f.params.stated)}. Please explain the difference.`,
  },
  pl: {
    quote: (f, a, _r, m) =>
      `Wycena warsztatu. Uzyskałem(-am) wycenę tej samej naprawy w warsztacie i załączam jej kopię. Wycena opiewa na ${m(f.params.garage)} netto, a kosztorys na ${m(f.params.insurer)}. Różnica: ${a}.`,
    labourRate: (f, a, r, m) =>
      `Stawka za roboczogodzinę. Kosztorys wycenia ${num(f.params.hours, 'pl')} godz. prac blacharsko-mechanicznych po ${m(f.params.rate)} za godzinę. Warsztaty w mojej okolicy stosują stawkę ${r} za godzinę. Różnica: ${a}.`,
    paintRate: (f, a, r, m) =>
      `Stawka za prace lakiernicze. Kosztorys wycenia ${num(f.params.hours, 'pl')} godz. prac lakierniczych po ${m(f.params.rate)} za godzinę, przy stawce lokalnej ${r} za godzinę. Różnica: ${a}.`,
    deductions: (f, a) =>
      `Potrącenia. Kosztorys obniża wypłatę przez potrącenia (liczba pozycji: ${f.params.count}), takie jak amortyzacja części lub rabaty. Nie wykazano, że rabaty te są dla mnie dostępne ani że montaż nowych części podniesie wartość pojazdu. Kwota potrąceń: ${a}.`,
    vat: (f, a) =>
      `VAT. Kosztorys sporządzono w kwotach netto. Nie mam prawa do odliczenia VAT, więc naprawa będzie mnie kosztować kwotę brutto. VAT ${num(f.params.rate, 'pl')}% od sumy kosztorysu: ${a}.`,
    alternativeParts: (f) =>
      `Kosztorys wycenia części (liczba pozycji: ${f.params.count}) jako zamienniki lub części używane. Proszę o podanie cen części oryginalnych i wyjaśnienie, dlaczego ich nie zastosowano.`,
    missingCalibration: () =>
      `Kosztorys przewiduje wymianę elementów, w których lub przy których zwykle znajdują się czujniki, kamery lub reflektory, a nie zawiera kalibracji. Proszę o potwierdzenie, czy kalibracja jest potrzebna, i uzupełnienie kosztorysu.`,
    missingAlignment: () =>
      `Kosztorys przewiduje wymianę elementów zawieszenia lub układu kierowniczego, a nie zawiera ustawienia geometrii kół. Proszę o jej dodanie albo wyjaśnienie, dlaczego nie jest potrzebna.`,
    arithmetic: (f, _a, _r, m) =>
      `Pozycje kosztorysu sumują się do ${m(f.params.lines)}, a wydrukowana suma to ${m(f.params.stated)}. Proszę o wyjaśnienie różnicy.`,
  },
};

const FRAME = {
  en: {
    head: '[DATE]\n\n[FULL NAME]\n\nTo: [INSURER]\nClaim number: [CLAIM NUMBER]\n\nSubject: Request to review the repair estimate and pay the outstanding amount',
    open: 'Dear Sir or Madam,\n\nI have reviewed the repair estimate issued for the claim above. I do not accept it as full settlement, because it understates the cost of repairing the vehicle in the following respects:',
    vatUplift: (a: string, rate: string) => `VAT at ${rate}% on the differences listed above: ${a}.`,
    total: (a: string) => `I therefore request an additional payment of ${a}.`,
    questionsHead: 'Please also address the following points:',
    close: 'Please pay the amount above within 14 days, or explain in writing, item by item, why you refuse. I reserve the right to have the vehicle assessed independently and to claim the full cost of repair.\n\nYours faithfully,\n[FULL NAME]',
  },
  pl: {
    head: '[DATE]\n\n[FULL NAME]\n\nDo: [INSURER]\nNumer szkody: [CLAIM NUMBER]\n\nDotyczy: wniosek o weryfikację kosztorysu naprawy i dopłatę odszkodowania',
    open: 'Szanowni Państwo,\n\nzapoznałem(-am) się z kosztorysem naprawy sporządzonym w powyższej sprawie. Nie uznaję go za pełne rozliczenie szkody, ponieważ zaniża koszt naprawy pojazdu w następujących punktach:',
    vatUplift: (a: string, rate: string) => `VAT ${rate}% od różnic wymienionych powyżej: ${a}.`,
    total: (a: string) => `W związku z tym wnoszę o dopłatę odszkodowania w kwocie ${a}.`,
    questionsHead: 'Proszę również o odniesienie się do następujących kwestii:',
    close: 'Proszę o wypłatę powyższej kwoty w terminie 14 dni albo o pisemne uzasadnienie odmowy, z odniesieniem do każdego punktu. Zastrzegam prawo do zlecenia niezależnej wyceny i dochodzenia pełnego kosztu naprawy.\n\nZ poważaniem\n[FULL NAME]',
  },
} as const;

const QUOTE_TEXT = {
  en: {
    kinds: { part: 'Parts', labour: 'Labour', paint: 'Paint work', material: 'Materials', other: 'Other work', deduction: 'Deductions' },
    head: 'The difference is made up as follows:',
    timed: (amount: string, hours: string, rate: string) => `${amount} (${hours} hours at ${rate} per hour)`,
    row: (label: string, insurer: string, garage: string) => `${label}: the estimate allows ${insurer}; the quote allows ${garage}.`,
    deduction: (insurer: string, garage: string | null) => `Deductions: the estimate deducts ${insurer}; the quote ${garage ? `deducts ${garage}` : 'has no deductions'}.`,
    extra: (list: string) => `Work in the quote that the estimate leaves out: ${list}.`,
  },
  pl: {
    kinds: { part: 'Części', labour: 'Robocizna', paint: 'Lakierowanie', material: 'Materiały', other: 'Pozostałe prace', deduction: 'Potrącenia' },
    head: 'Na różnicę składają się:',
    timed: (amount: string, hours: string, rate: string) => `${amount} (${hours} godz. po ${rate})`,
    row: (label: string, insurer: string, garage: string) => `${label}: w kosztorysie ${insurer}; w wycenie warsztatu ${garage}.`,
    deduction: (insurer: string, garage: string | null) => `Potrącenia: kosztorys potrąca ${insurer}; wycena warsztatu ${garage ? `potrąca ${garage}` : 'nie zawiera potrąceń'}.`,
    extra: (list: string) => `Prace ujęte w wycenie warsztatu, których nie ma w kosztorysie: ${list}.`,
  },
} as const;

/** The lines under the workshop-quote point: one per category that differs, then the work only the quote has. */
export function quoteBreakdown(comparison: Comparison, lang: Lang, fmt: (n: number) => string): string {
  const text = QUOTE_TEXT[lang];
  const side = (row: GapRow, who: 'insurer' | 'garage') => {
    const hours = who === 'insurer' ? row.insurerHours : row.garageHours;
    const rate = who === 'insurer' ? row.insurerRate : row.garageRate;
    const amount = fmt(row[who]);
    return hours != null && rate != null ? text.timed(amount, num(hours, lang), fmt(rate)) : amount;
  };
  const lines = comparison.rows
    .filter((row) => row.gap !== 0)
    .map((row) =>
      row.kind === 'deduction'
        ? text.deduction(fmt(Math.abs(row.insurer)), row.garage === 0 ? null : fmt(Math.abs(row.garage)))
        : text.row(text.kinds[row.kind], side(row, 'insurer'), side(row, 'garage')),
    );
  const out = [text.head, ...lines.map((line) => `   - ${line}`)];
  if (comparison.extra.length > 0) {
    out.push(`   ${text.extra(comparison.extra.map((i) => `${i.desc} (${fmt(Math.abs(i.total ?? 0))})`).join('; '))}`);
  }
  return out.join('\n');
}

/**
 * The letter in five pieces. `open` and `close` are prose without figures from the audit;
 * they are the only pieces a model is ever asked to reword. `middle` holds every amount.
 */
export interface LetterParts {
  before: string;
  open: string;
  middle: string;
  close: string;
  after: string;
}

export const joinLetter = (p: LetterParts) => [p.before, p.open, p.middle, p.close, p.after].filter(Boolean).join('\n\n');

/** Builds the letter from the audit result alone. Every amount in it comes from the audit, not from a model. */
export function draftLetter(estimate: Estimate, findings: Finding[], selected: Set<string>, tier: Tier, lang: Lang, comparison: Comparison | null = null): string {
  return joinLetter(letterParts(estimate, findings, selected, tier, lang, comparison));
}

export function letterParts(estimate: Estimate, findings: Finding[], selected: Set<string>, tier: Tier, lang: Lang, comparison: Comparison | null = null): LetterParts {
  const chosen = findings.filter((f) => selected.has(f.id));
  const withAmount = chosen.filter((f) => f.amounts && f.amounts[tier] > 0);
  const questions = chosen.filter((f) => !f.amounts);
  const frame = FRAME[lang];
  const fmt = (n: number) => money(n, estimate.currency, lang);
  const tierRate = (f: Finding) => (f.params.mid == null ? '' : fmt(Number(tier === 'cautious' ? f.params.low : tier === 'realistic' ? f.params.mid : f.params.high)));

  const m: Fmt = (n) => fmt(Number(n));
  const points = withAmount.map((f) => {
    const point = POINTS[lang][f.id](f, fmt(f.amounts![tier]), tierRate(f), m);
    return f.id === 'quote' && comparison ? `${point} ${quoteBreakdown(comparison, lang, fmt)}` : point;
  });
  const upliftVat = vatOnUplift(findings, selected)[tier];
  const vat = findings.find((f) => f.id === 'vat');
  if (upliftVat > 0 && vat) points.push(frame.vatUplift(fmt(upliftVat), num(vat.params.rate, lang)));
  const total = withAmount.reduce((s, f) => s + f.amounts![tier], 0) + upliftVat;

  const [salute, open] = frame.open.split('\n\n');
  const [close, sign] = frame.close.split('\n\n');
  const middle: string[] = [];
  if (points.length > 0) {
    middle.push(points.map((p, n) => `${n + 1}. ${p}`).join('\n'));
    middle.push(frame.total(fmt(Math.round((total + Number.EPSILON) * 100) / 100)));
  }
  if (questions.length > 0) {
    middle.push(`${frame.questionsHead}\n${questions.map((f) => `- ${POINTS[lang][f.id](f, '', '', m)}`).join('\n')}`);
  }
  return { before: `${frame.head}\n\n${salute}`, open, middle: middle.join('\n\n'), close, after: sign };
}

export function fillDetails(letter: string, details: LetterDetails, lang: Lang): string {
  const date = new Intl.DateTimeFormat(LOCALE[lang], { dateStyle: 'long' }).format(new Date());
  const put = (text: string, tag: string, value: string) => (value.trim() ? text.split(tag).join(value.trim()) : text);
  let out = letter.split('[DATE]').join(date);
  out = put(out, '[FULL NAME]', details.name);
  out = put(out, '[INSURER]', details.insurer);
  out = put(out, '[CLAIM NUMBER]', details.claimNumber);
  return out;
}

const POLISH_TEXT: Record<Lang, string> = {
  en: `Rewrite the two paragraphs below. They open and close a letter from a private person to an insurance company about a repair estimate. {TONE} Write in English.
Rules:
- Keep the meaning of each paragraph.
- Keep every number exactly as written.
- Do not add facts, amounts, dates, laws or threats.
- Do not add a greeting, a signature or a list.
- Do not leave blanks to fill in, and do not mention a claim number or a sum of money.
- The first paragraph must still say that the estimate is not accepted. The second must still ask the insurer to pay within the same number of days.
- Do not number the paragraphs.
Return the first paragraph, then a line with only three dashes (---), then the second paragraph. Nothing else.`,
  pl: `Przeredaguj dwa poniższe akapity. Otwierają i zamykają pismo osoby prywatnej do zakładu ubezpieczeń w sprawie kosztorysu naprawy. {TONE} Pisz po polsku.
Zasady:
- Zachowaj sens każdego akapitu.
- Zachowaj każdą liczbę dokładnie tak, jak w tekście.
- Nie dodawaj faktów, kwot, dat, przepisów ani gróźb.
- Nie dodawaj powitania, podpisu ani wyliczeń.
- Nie zostawiaj pustych miejsc do uzupełnienia i nie wspominaj o numerze szkody ani o kwocie.
- Pierwszy akapit nadal ma mówić, że kosztorys nie jest akceptowany. Drugi nadal ma wzywać ubezpieczyciela do zapłaty w tym samym terminie.
- Nie numeruj akapitów.
Zwróć pierwszy akapit, potem linię zawierającą tylko trzy myślniki (---), potem drugi akapit. Nic więcej.`,
};

/**
 * The prompt for improving the wording. Only the opening and the closing paragraph are in it.
 * The numbered points, which hold every amount of the claim, never reach a model.
 */
export type Tone = 'firmer' | 'friendlier' | 'shorter';

const TONES: Record<Lang, Record<Tone, string>> = {
  en: {
    firmer: 'Make them firmer and more direct, and still polite: it must be plain that the estimate is not accepted and that an answer in writing is expected.',
    friendlier: 'Make them warmer and more cooperative, without dropping any request.',
    shorter: 'Make them shorter: at most two sentences each.',
  },
  pl: {
    firmer: 'Mają być bardziej stanowcze i bezpośrednie, nadal uprzejme: ma być jasne, że kosztorys nie jest akceptowany i że oczekiwana jest odpowiedź na piśmie.',
    friendlier: 'Mają być cieplejsze i nastawione na współpracę, bez rezygnowania z żadnego żądania.',
    shorter: 'Mają być krótsze: najwyżej po dwa zdania.',
  },
};

export function polishPrompt(parts: LetterParts, lang: Lang, tone: Tone = 'firmer'): string {
  return `${POLISH_TEXT[lang].replace('{TONE}', TONES[lang][tone])}\n\nFIRST PARAGRAPH:\n${parts.open}\n\nSECOND PARAGRAPH:\n${parts.close}`;
}

const NUMBER = /\d+(?:[ \u00a0\u202f.,]\d+)*/g;
const numbersOf = (text: string) => (text.match(NUMBER) ?? []).map((raw) => ({ raw, digits: raw.replace(/\D/g, '') }));
const tagsOf = (text: string) => text.match(/\[[A-Z ]+\]/g) ?? [];

export interface RewriteCheck {
  ok: boolean;
  reason?: 'number_added' | 'number_missing' | 'placeholder_missing';
  /** The number or placeholder that failed the check, as written. */
  value?: string;
}

/**
 * Checks a model-edited letter against the draft it was made from.
 * The edit is rejected if it contains a number the draft does not, drops a number, or drops a placeholder.
 */
export function verifyRewrite(draft: string, rewritten: string): RewriteCheck {
  const allowed = numbersOf(draft);
  const got = numbersOf(rewritten);
  const added = got.find((n) => !allowed.some((a) => a.digits === n.digits));
  if (added) return { ok: false, reason: 'number_added', value: added.raw };
  const missing = allowed.find((a) => a.digits.length >= 3 && !got.some((n) => n.digits === a.digits));
  if (missing) return { ok: false, reason: 'number_missing', value: missing.raw };
  const tags = new Set(tagsOf(rewritten));
  const lost = tagsOf(draft).find((t) => !tags.has(t));
  if (lost) return { ok: false, reason: 'placeholder_missing', value: lost };
  return { ok: true };
}

/** What each paragraph has to keep saying, whatever the tone: a refusal in the first, a demand to pay in the second. */
const REFUSAL = /\b(not|cannot|can't|don't|won't)\s+(\w+\s+){0,3}(accept|agree)|disagree|reject|dispute|object\b|nie\s+(\S+\s+){0,3}(akcept|zgadzam|przyjmuj|uznaj)|kwestionuj|odrzucam|sprzeciw/i;
const DEMAND = /\b(pay|payment|remit|settle)\b|wypłat|zapłat|dopłat|uregulow/i;

export type PolishResult = { ok: true; parts: LetterParts; changed: boolean } | { ok: false; reason: NonNullable<RewriteCheck['reason']> | 'shape' | 'meaning'; value?: string };

/** Puts the model's two paragraphs into the letter, if they pass the checks. */
export function applyPolish(parts: LetterParts, answer: string): PolishResult {
  const pieces = answer
    .replace(/^\s*(FIRST|SECOND) PARAGRAPH:\s*/gim, '')
    .split(/\n\s*-{3,}\s*\n/)
    .map((piece) => piece.trim());
  if (pieces.length !== 2 || pieces.some((piece) => piece.length < 20 || /\n\s*[-*\d]+[.)]?\s/.test(piece) || /\[/.test(piece))) return { ok: false, reason: 'shape' };
  // A model that numbers the paragraphs has started writing a list of its own.
  if (pieces.some((piece) => /^\s*(\d+[.)]|[-*•])\s/.test(piece))) return { ok: false, reason: 'shape' };
  const [open, close] = pieces.map((piece) => piece.replace(/\s*\n\s*/g, ' '));
  if (!REFUSAL.test(open) || !DEMAND.test(close)) return { ok: false, reason: 'meaning' };
  const before = `${parts.open}\n${parts.close}`;
  const after = `${open}\n${close}`;
  // Blanks to fill in, or a currency sign that the two paragraphs never had, mean the model
  // started writing about amounts. A deadline written out in words ("fourteen days") is a changed figure.
  if (/_{2,}|\.{4,}|\bX{3,}\b/.test(after) || (/[$£€]|\b(PLN|USD|EUR|GBP)\b|\bz[lł]\b/.test(after) && !/[$£€]|\b(PLN|USD|EUR|GBP)\b|\bz[lł]\b/.test(before))) return { ok: false, reason: 'shape' };
  const check = verifyRewrite(before, after);
  if (!check.ok) return { ok: false, reason: check.reason ?? 'number_added', value: check.value };
  // Every figure of the two paragraphs has to come back as a figure, in the same order.
  const figures = (text: string): string[] => text.match(/\d+/g) ?? [];
  const lost = figures(before).find((n) => !figures(after).includes(n));
  if (lost || figures(before).join(' ') !== figures(after).join(' ')) return { ok: false, reason: 'number_missing', value: lost ?? figures(before)[0] };
  const flat = (text: string) => text.replace(/\s+/g, ' ').trim();
  return { ok: true, parts: { ...parts, open, close }, changed: flat(after) !== flat(before) };
}
