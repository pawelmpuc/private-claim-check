import { sumMismatch } from '../lib/audit';
import { emptyItem } from '../lib/extract';
import { money } from '../lib/letter';
import type { Key } from '../lib/i18n';
import type { Estimate, EstimateItem, ItemKind, PartQuality } from '../lib/types';
import { useT } from '../lib/useT';

const KINDS: ItemKind[] = ['part', 'labour', 'paint', 'material', 'deduction', 'other'];
const QUALITIES: PartQuality[] = ['oem', 'alternative', 'used', 'unknown'];

export const toNum = (value: string): number | null => {
  if (value.trim() === '') return null;
  const n = Number(value.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

export function NumberField({ label, value, onChange, step = 'any' }: { label: string; value: number | null; onChange: (v: number | null) => void; step?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" inputMode="decimal" min="0" step={step} value={value ?? ''} onChange={(e) => onChange(toNum(e.target.value))} />
    </label>
  );
}

/** The editable lines of an estimate or a quote. */
export function LinesTable({ estimate, onChange, label, quiet = false }: { estimate: Estimate; onChange: (estimate: Estimate) => void; label: string; quiet?: boolean }) {
  const { t, lang } = useT();
  // `quiet` is for a caller that shows the warning itself.
  const mismatch = quiet ? null : sumMismatch(estimate);
  const patchItem = (id: string, patch: Partial<EstimateItem>) =>
    onChange({ ...estimate, items: estimate.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) });

  return (
    <>
      {mismatch && (
        <p className="error" role="alert">
          {t('sumMismatch', { lines: money(mismatch.lines, estimate.currency, lang), stated: money(mismatch.stated, estimate.currency, lang) })}
        </p>
      )}
      {estimate.items.some((i) => i.check) && <p className="notice">{t('checkLine')}</p>}
      <div className="table" role="table" aria-label={label}>
        <div className="tr th" role="row">
          <span role="columnheader">{t('colDesc')}</span>
          <span role="columnheader">{t('colKind')}</span>
          <span role="columnheader">{t('colQuality')}</span>
          <span role="columnheader">{t('colHours')}</span>
          <span role="columnheader">{t('colTotal')}</span>
          <span />
        </div>
        {estimate.items.map((item) => (
          <div className={`tr kind-${item.kind}${item.check ? ' check' : ''}`} role="row" key={item.id} title={item.check ? t('checkLine') : undefined}>
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
              onChange={(e) => patchItem(item.id, { total: toNum(e.target.value), check: false })}
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
    </>
  );
}
