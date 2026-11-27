import { COUNTRIES } from '../lib/countries';
import { emptyItem } from '../lib/extract';
import type { Key } from '../lib/i18n';
import type { AuditSettings, Estimate, EstimateItem, ItemKind, PartQuality } from '../lib/types';
import { useT } from '../lib/useT';

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
}

const KINDS: ItemKind[] = ['part', 'labour', 'paint', 'material', 'deduction', 'other'];
const QUALITIES: PartQuality[] = ['oem', 'alternative', 'used', 'unknown'];
const CURRENCIES = ['PLN', 'EUR', 'GBP', 'USD', 'CHF', 'CZK', 'SEK', 'NOK', 'DKK', 'CAD', 'AUD'];

const toNum = (value: string): number | null => {
  if (value.trim() === '') return null;
  const n = Number(value.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

function NumberField({ label, value, onChange, step = 'any' }: { label: string; value: number | null; onChange: (v: number | null) => void; step?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" inputMode="decimal" min="0" step={step} value={value ?? ''} onChange={(e) => onChange(toNum(e.target.value))} />
    </label>
  );
}

export function StepReview({ estimate, onChange, onCurrency, country, onCountry, settings, onSettings, rawRead }: Props) {
  const { t, lang } = useT();
  const currencies = CURRENCIES.includes(estimate.currency) ? CURRENCIES : [estimate.currency, ...CURRENCIES];

  const patchItem = (id: string, patch: Partial<EstimateItem>) =>
    onChange({ ...estimate, items: estimate.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) });

  return (
    <section className="card" aria-labelledby="step2">
      <h2 id="step2">{t('step2')}</h2>
      <p className="notice">{t('reviewHint')}</p>

      {rawRead && (
        <details className="raw">
          <summary>{t('rawRead')}</summary>
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

      <div className="table" role="table" aria-label={t('step2')}>
        <div className="tr th" role="row">
          <span role="columnheader">{t('colDesc')}</span>
          <span role="columnheader">{t('colKind')}</span>
          <span role="columnheader">{t('colQuality')}</span>
          <span role="columnheader">{t('colHours')}</span>
          <span role="columnheader">{t('colTotal')}</span>
          <span />
        </div>
        {estimate.items.map((item) => (
          <div className={`tr kind-${item.kind}`} role="row" key={item.id}>
            <input aria-label={t('colDesc')} value={item.desc} onChange={(e) => patchItem(item.id, { desc: e.target.value })} />
            <select aria-label={t('colKind')} value={item.kind} onChange={(e) => patchItem(item.id, { kind: e.target.value as ItemKind })}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`kind_${k}` as Key)}
                </option>
              ))}
            </select>
            <select
              aria-label={t('colQuality')}
              value={item.partQuality}
              disabled={item.kind !== 'part'}
              onChange={(e) => patchItem(item.id, { partQuality: e.target.value as PartQuality })}
            >
              {QUALITIES.map((q) => (
                <option key={q} value={q}>
                  {t(`q_${q}` as Key)}
                </option>
              ))}
            </select>
            <input
              aria-label={t('colHours')}
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={item.hours ?? ''}
              disabled={item.kind !== 'labour' && item.kind !== 'paint'}
              onChange={(e) => patchItem(item.id, { hours: toNum(e.target.value) })}
            />
            <input
              aria-label={t('colTotal')}
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={item.total ?? ''}
              onChange={(e) => patchItem(item.id, { total: toNum(e.target.value) })}
            />
            <button type="button" className="icon" aria-label={t('remove')} title={t('remove')} onClick={() => onChange({ ...estimate, items: estimate.items.filter((i) => i.id !== item.id) })}>
              ×
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="btn" onClick={() => onChange({ ...estimate, items: [...estimate.items, emptyItem()] })}>
        {t('addLine')}
      </button>

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
