import { TIERS, tierTotals, vatOnUplift } from '../lib/audit';
import type { Key } from '../lib/i18n';
import { money } from '../lib/letter';
import type { Estimate, Finding } from '../lib/types';
import { useT } from '../lib/useT';

interface Props {
  estimate: Estimate;
  findings: Finding[];
  selected: Set<string>;
  onToggle: (id: string) => void;
}

export function StepFindings({ estimate, findings, selected, onToggle }: Props) {
  const { t, lang } = useT();
  const fmt = (n: number) => money(n, estimate.currency, lang);
  const claimable = findings.filter((f) => f.amounts);
  const questions = findings.filter((f) => !f.amounts);
  const totals = tierTotals(findings, selected);
  const hasVatUplift = vatOnUplift(findings, selected).optimistic > 0;

  const describe = (f: Finding) => {
    const params: Record<string, string | number> = { ...f.params };
    for (const key of ['rate', 'lines', 'stated']) {
      if (f.id !== 'vat' && typeof params[key] === 'number') params[key] = fmt(params[key] as number);
    }
    return t(`d_${f.id}` as Key, params);
  };

  return (
    <section className="card" aria-labelledby="step3">
      <h2 id="step3">{t('step3')}</h2>

      {findings.length === 0 ? (
        <p className="help">{t('noFindings')}</p>
      ) : (
        <>
          {claimable.length > 0 && (
            <>
              <h3>{t('totalsTitle')}</h3>
              <div className="tiers">
                {TIERS.map((tier) => (
                  <div key={tier} className={`tier tier-${tier}`}>
                    <span className="tier-name">{t(`tier_${tier}` as Key)}</span>
                    <strong>{fmt(totals[tier])}</strong>
                    <small>{t(`tierHelp_${tier}` as Key)}</small>
                  </div>
                ))}
              </div>
              {hasVatUplift && <p className="help">{t('vatUpliftNote')}</p>}

              <h3>{t('claimable')}</h3>
              <ul className="findings">
                {claimable.map((f) => (
                  <li key={f.id} className={selected.has(f.id) ? '' : 'off'}>
                    <label>
                      <input type="checkbox" checked={selected.has(f.id)} onChange={() => onToggle(f.id)} aria-label={t('include')} />
                      <span>
                        <strong>{t(`f_${f.id}` as Key)}</strong>
                        <span className="desc">{describe(f)}</span>
                      </span>
                    </label>
                    <span className="amounts">
                      {TIERS.map((tier) => (
                        <span key={tier} className={`amt tier-${tier}`} title={t(`tier_${tier}` as Key)}>
                          {fmt(f.amounts![tier])}
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {questions.length > 0 && (
            <>
              <h3>{t('questions')}</h3>
              <ul className="findings">
                {questions.map((f) => (
                  <li key={f.id} className={selected.has(f.id) ? '' : 'off'}>
                    <label>
                      <input type="checkbox" checked={selected.has(f.id)} onChange={() => onToggle(f.id)} aria-label={t('include')} />
                      <span>
                        <strong>{t(`f_${f.id}` as Key)}</strong>
                        <span className="desc">{describe(f)}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}
