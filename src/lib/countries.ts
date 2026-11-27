import type { Lang } from './types';

export interface Country {
  code: string;
  name: Record<Lang, string>;
  currency: string;
  /** Standard VAT or sales tax rate on car repairs, in percent. Shown as an editable default. */
  vat: number;
}

/** The country sets the currency and the default tax rate. Hourly rates still come from the user. */
export const COUNTRIES: Country[] = [
  { code: 'PL', name: { en: 'Poland', pl: 'Polska' }, currency: 'PLN', vat: 23 },
  { code: 'GB', name: { en: 'United Kingdom', pl: 'Wielka Brytania' }, currency: 'GBP', vat: 20 },
  { code: 'IE', name: { en: 'Ireland', pl: 'Irlandia' }, currency: 'EUR', vat: 23 },
  { code: 'DE', name: { en: 'Germany', pl: 'Niemcy' }, currency: 'EUR', vat: 19 },
  { code: 'NL', name: { en: 'Netherlands', pl: 'Holandia' }, currency: 'EUR', vat: 21 },
  { code: 'FR', name: { en: 'France', pl: 'Francja' }, currency: 'EUR', vat: 20 },
  { code: 'ES', name: { en: 'Spain', pl: 'Hiszpania' }, currency: 'EUR', vat: 21 },
  { code: 'IT', name: { en: 'Italy', pl: 'Włochy' }, currency: 'EUR', vat: 22 },
  { code: 'US', name: { en: 'United States', pl: 'Stany Zjednoczone' }, currency: 'USD', vat: 0 },
  { code: 'OTHER', name: { en: 'Other country', pl: 'Inny kraj' }, currency: 'EUR', vat: 20 },
];

export const countryByCode = (code: string): Country => COUNTRIES.find((c) => c.code === code) ?? COUNTRIES[COUNTRIES.length - 1];

/** Picks a country for an estimate from its currency, keeping the current choice when it already fits. */
export function countryForCurrency(currency: string, current: string): string {
  if (countryByCode(current).currency === currency && current !== 'OTHER') return current;
  return COUNTRIES.find((c) => c.currency === currency)?.code ?? 'OTHER';
}
