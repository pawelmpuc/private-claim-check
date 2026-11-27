/**
 * Removes identifiers that follow a fixed pattern before text is sent to a cloud model.
 * It cannot recognise names or street addresses, and the interface says so.
 */
const PATTERNS: Array<[RegExp, string]> = [
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]'],
  [/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,7}(?:[ ]?[A-Z0-9]{1,4})?\b/g, '[IBAN]'],
  [/\b(?=[A-HJ-NPR-Z0-9]{17}\b)(?=[A-HJ-NPR-Z0-9]*[A-HJ-NPR-Z])(?=[A-HJ-NPR-Z0-9]*\d)[A-HJ-NPR-Z0-9]{17}\b/g, '[VIN]'],
  [/\b\d{11}\b/g, '[ID NUMBER]'],
  [/(?:\+\d{1,3}[ -]?)?(?:\(\d{2,4}\)[ -]?)?\b\d{3}[ -]?\d{3}[ -]?\d{3,4}\b/g, '[PHONE]'],
  [/\b[A-Z]{1,3}[ -]?(?=[A-Z0-9]{4,5}\b)(?=[A-Z0-9]*\d)[A-Z0-9]{4,5}\b/g, '[PLATE]'],
];

export function redact(text: string): { text: string; count: number } {
  let count = 0;
  let out = text;
  for (const [pattern, label] of PATTERNS) {
    out = out.replace(pattern, () => {
      count += 1;
      return label;
    });
  }
  return { text: out, count };
}
