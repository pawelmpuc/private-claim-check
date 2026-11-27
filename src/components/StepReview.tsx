import { COUNTRIES } from '../lib/countries';
import type { AuditSettings, Estimate, InferenceLogEntry } from '../lib/types';
import { useT } from '../lib/useT';
import { Explain } from './Explain';
import { LinesTable, NumberField } from './LinesTable';

interface Props {
  estimate: Estimate;
  onChange: (estimate: Estimate) => void;
  onCurrency: (currency: string) => void;
  country: string;
  onCountry: (code: string) => void;
  settings: AuditSettings;
  onSettings: (settings: AuditSettings) => void;
  /** What the on-device model wrote, shown so the user can see where a line came from. */
  rawRead: string | null;
  rawFromPdf?: boolean;
  allowCloud: boolean;
  onLog: (entry: Omit<InferenceLogEntry, 'at'>) => void;
}

const CURRENCIES = ['PLN', 'EUR', 'GBP', 'USD', 'CHF', 'CZK', 'SEK', 'NOK', 'DKK', 'CAD', 'AUD'];

export function StepReview({ estimate, onChange, onCurrency, country, onCountry, settings, onSettings, rawRead, rawFromPdf, allowCloud, onLog }: Props) {
  const { t, lang } = useT();
  const currencies = CURRENCIES.includes(estimate.currency) ? CURRENCIES : [estimate.currency, ...CURRENCIES];

  return (
    <section className="card" aria-labelledby="step2">
      <h2 id="step2">{t('step2')}</h2>
      <p className="notice">{t('reviewHint')}</p>

      {rawRead && (
        <details className="raw">
          <summary>{t(rawFromPdf ? 'rawPdf' : 'rawRead')}</summary>
          <pre className="live">{rawRead}</pre>
        </details>
      )}

      <div className="fields">
        <label className="field">
          <span>{t('country')}</span>
          <select value={country} onChange={(e) => onCountry(e.target.value)}>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name[lang]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t('currency')}</span>
          <select value={estimate.currency} onChange={(e) => onCurrency(e.target.value)}>
            {currencies.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <NumberField label={t('labourRate')} value={estimate.labourRate} onChange={(v) => onChange({ ...estimate, labourRate: v })} />
        <NumberField label={t('paintRate')} value={estimate.paintRate} onChange={(v) => onChange({ ...estimate, paintRate: v })} />
        <NumberField label={t('statedTotal')} value={estimate.statedTotal} onChange={(v) => onChange({ ...estimate, statedTotal: v })} />
      </div>

      <LinesTable estimate={estimate} onChange={onChange} label={t('step2')} />

      <Explain estimate={estimate} allowCloud={allowCloud} onLog={onLog} />

      <h3>{t('refRatesTitle')}</h3>
      <p className="help">{t('refRatesHelp')}</p>
      <div className="fields">
        <NumberField label={t('refLow')} value={settings.refRates.low} onChange={(v) => onSettings({ ...settings, refRates: { ...settings.refRates, low: v ?? 0 } })} />
        <NumberField label={t('refMid')} value={settings.refRates.mid} onChange={(v) => onSettings({ ...settings, refRates: { ...settings.refRates, mid: v ?? 0 } })} />
        <NumberField label={t('refHigh')} value={settings.refRates.high} onChange={(v) => onSettings({ ...settings, refRates: { ...settings.refRates, high: v ?? 0 } })} />
      </div>

      <h3>{t('settingsTitle')}</h3>
      <div className="checks">
        <label className="switch">
          <input type="checkbox" checked={settings.totalIsNet} onChange={(e) => onSettings({ ...settings, totalIsNet: e.target.checked })} />
          <span>{t('totalIsNet')}</span>
        </label>
        <label className="switch">
          <input type="checkbox" checked={settings.claimantDeductsVat} onChange={(e) => onSettings({ ...settings, claimantDeductsVat: e.target.checked })} />
          <span>{t('deductsVat')}</span>
        </label>
        <NumberField label={t('vatRate')} value={settings.vatRatePct} onChange={(v) => onSettings({ ...settings, vatRatePct: v ?? 0 })} />
      </div>
    </section>
  );
}
