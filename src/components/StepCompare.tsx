import { sumMismatch } from '../lib/audit';
import type { Comparison } from '../lib/compare';
import type { Key } from '../lib/i18n';
import { money } from '../lib/letter';
import type { Estimate } from '../lib/types';
import { useT } from '../lib/useT';
import { LinesTable, NumberField } from './LinesTable';

interface Props {
  estimate: Estimate;
  quote: Estimate;
  onQuote: (quote: Estimate) => void;
  comparison: Comparison;
  rawRead: string | null;
}

/** The workshop quote, editable, and how it differs from the insurer's estimate. */
export function StepCompare({ estimate, quote, onQuote, comparison, rawRead }: Props) {
  const { t, lang } = useT();
  const fmt = (n: number) => money(n, estimate.currency, lang);
  const signed = (n: number) => (n > 0 ? `+${fmt(n)}` : fmt(n));
  const timed = (hours: number | null, rate: number | null) => (hours != null && rate != null ? t('cmpHours', { h: new Intl.NumberFormat(lang).format(hours), r: fmt(rate) }) : null);

  return (
    <section className="card card-optional" aria-labelledby="stepc">
      <h2 id="stepc">{t('cmpTitle')}</h2>
      {sumMismatch(quote) && (
        <p className="error" role="alert">
          {t('sumMismatch', { lines: fmt(sumMismatch(quote)!.lines), stated: fmt(sumMismatch(quote)!.stated) })}
        </p>
      )}
      {quote.currency !== estimate.currency && <p className="notice">{t('cmpCurrency', { a: estimate.currency, b: quote.currency })}</p>}

      <div className="cmp" role="table" aria-label={t('cmpTitle')}>
        <div className="cmp-row cmp-head" role="row">
          <span role="columnheader">{t('cmpCategory')}</span>
          <span role="columnheader">{t('cmpInsurer')}</span>
          <span role="columnheader">{t('cmpGarage')}</span>
          <span role="columnheader">{t('cmpGap')}</span>
        </div>
        {comparison.rows.map((row) => (
          <div className="cmp-row" role="row" key={row.kind}>
            <span role="cell">{t(`cat_${row.kind}` as Key)}</span>
            <span role="cell">
              {fmt(row.insurer)}
              {timed(row.insurerHours, row.insurerRate) && <small>{timed(row.insurerHours, row.insurerRate)}</small>}
            </span>
            <span role="cell">
              {fmt(row.garage)}
              {timed(row.garageHours, row.garageRate) && <small>{timed(row.garageHours, row.garageRate)}</small>}
            </span>
            <span role="cell" className={row.gap > 0 ? 'gap-up' : ''}>
              {signed(row.gap)}
            </span>
          </div>
        ))}
        <div className="cmp-row cmp-total" role="row">
          <span role="cell">{t('cmpTotal')}</span>
          <span role="cell">{fmt(comparison.insurerNet)}</span>
          <span role="cell">{fmt(comparison.garageNet)}</span>
          <span role="cell" className={comparison.gap > 0 ? 'gap-up' : ''}>
            {signed(comparison.gap)}
          </span>
        </div>
      </div>
      <p className={comparison.gap > 0 ? 'success' : 'notice'}>{t(comparison.gap > 0 ? 'cmpUsed' : 'cmpNotHigher')}</p>

      {comparison.extra.length > 0 && (
        <>
          <h3>{t('cmpExtra')}</h3>
          <ul className="extra">
            {comparison.extra.map((item) => (
              <li key={item.id}>
                <span>{item.desc}</span>
                <strong>{fmt(Math.abs(item.total ?? 0))}</strong>
              </li>
            ))}
          </ul>
          <p className="help">{t('cmpExtraHelp')}</p>
        </>
      )}

      <details className="quote-lines" open={quote.items.some((i) => i.check) || sumMismatch(quote) != null || undefined}>
        <summary>{t('quoteLines')}</summary>
        <p className="notice">{t('quoteCheck')}</p>
        {rawRead && (
          <details className="raw">
            <summary>{t('rawRead')}</summary>
            <pre className="live">{rawRead}</pre>
          </details>
        )}
        <div className="fields">
          <NumberField label={t('labourRate')} value={quote.labourRate} onChange={(v) => onQuote({ ...quote, labourRate: v })} />
          <NumberField label={t('paintRate')} value={quote.paintRate} onChange={(v) => onQuote({ ...quote, paintRate: v })} />
        </div>
        <LinesTable estimate={quote} onChange={onQuote} label={t('quoteLines')} quiet />
      </details>
    </section>
  );
}
