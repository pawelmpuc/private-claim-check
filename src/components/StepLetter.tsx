import { useEffect, useMemo, useState } from 'react';
import { CloudNotAllowedError, DeviceTimeoutError, firebaseConfigured, NotConfiguredError, run, tuning } from '../lib/ai';
import { TIERS, tierTotals } from '../lib/audit';
import type { Comparison } from '../lib/compare';
import type { Key } from '../lib/i18n';
import { applyPolish, fillDetails, joinLetter, letterParts, money, polishPrompt, type LetterDetails, type Tone } from '../lib/letter';
import { redact } from '../lib/redact';
import type { Estimate, Finding, InferenceLogEntry, Lang, Tier } from '../lib/types';
import { useT } from '../lib/useT';

interface Props {
  estimate: Estimate;
  findings: Finding[];
  selected: Set<string>;
  /** Set when a workshop quote is the basis of the claim. */
  comparison: Comparison | null;
  tier: Tier;
  onTier: (tier: Tier) => void;
  allowCloud: boolean;
  onLog: (entry: Omit<InferenceLogEntry, 'at'>) => void;
}

export function StepLetter({ estimate, findings, selected, comparison, tier, onTier, allowCloud, onLog }: Props) {
  const { t, lang } = useT();
  const [details, setDetails] = useState<LetterDetails>({ name: '', insurer: '', claimNumber: '' });
  const [rewrite, setRewrite] = useState<{ draft: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [live, setLive] = useState('');
  const [discarded, setDiscarded] = useState<string | null>(null);
  // The letter goes to the insurer, so its language can differ from the interface language.
  const [letterLang, setLetterLang] = useState<Lang>(lang);
  useEffect(() => setLetterLang(lang), [lang]);

  const parts = useMemo(() => letterParts(estimate, findings, selected, tier, letterLang, comparison), [estimate, findings, selected, tier, letterLang, comparison]);
  const draft = useMemo(() => joinLetter(parts), [parts]);
  const totals = tierTotals(findings, selected);
  // A rewrite is only valid for the exact draft it was made from.
  const body = rewrite && rewrite.draft === draft ? rewrite.text : draft;
  const [text, setText] = useState('');
  useEffect(() => setText(fillDetails(body, details, letterLang)), [body, details, letterLang]);
  useEffect(() => {
    setMessage(null);
    setDiscarded(null);
  }, [draft]);

  const polish = async (tone: Tone) => {
    setBusy(true);
    setMessage(null);
    setLive('');
    setDiscarded(null);
    try {
      const prompt = polishPrompt(parts, letterLang, tone);
      const safe = redact(prompt);
      const res = await run({ deviceParts: [prompt], cloudParts: [safe.text], allowCloud, outputLang: letterLang, onText: setLive });
      onLog({ step: 'letter', source: res.source, redactions: res.source === 'in_cloud' ? safe.count : 0, note: res.deviceError ? 'device_failed' : undefined });
      if (!res.text.trim()) {
        setRewrite(null);
        setMessage({ kind: 'error', text: t('polishEmpty') });
        return;
      }
      const result = applyPolish(parts, res.text);
      if (result.ok && !result.changed) {
        setRewrite(null);
        setMessage({ kind: 'error', text: t('polishSame') });
      } else if (result.ok) {
        setRewrite({ draft, text: joinLetter(result.parts) });
        setMessage({ kind: 'ok', text: t('polishOk', { where: t(res.source === 'on_device' ? 'srcDevice' : 'srcCloud') }) });
      } else {
        setRewrite(null);
        setDiscarded(res.text.trim());
        setMessage({ kind: 'error', text: t(`polishRejected_${result.reason}` as Key, { value: result.value ?? '' }) });
      }
    } catch (err) {
      if (err instanceof DeviceTimeoutError) setMessage({ kind: 'error', text: t('errDeviceTimeout', { s: tuning.deviceTimeoutS }) });
      else if (err instanceof CloudNotAllowedError) setMessage({ kind: 'error', text: t('errCloudNotAllowed') });
      else if (err instanceof NotConfiguredError) setMessage({ kind: 'error', text: t('errNotConfigured') });
      else setMessage({ kind: 'error', text: t('errGeneric', { msg: err instanceof Error ? err.message : String(err) }) });
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = letterLang === 'pl' ? 'odwolanie.txt' : 'appeal-letter.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const field = (key: keyof LetterDetails, label: string) => (
    <label className="field">
      <span>{label}</span>
      <input value={details[key]} onChange={(e) => setDetails({ ...details, [key]: e.target.value })} autoComplete="off" />
    </label>
  );

  return (
    <section className="card" aria-labelledby="step4">
      <h2 id="step4">{t('step4')}</h2>

      {selected.size === 0 ? (
        <p className="help">{t('letterEmpty')}</p>
      ) : (
        <>
          <fieldset className="tier-pick">
            <legend>{t('letterTier')}</legend>
            {(totals.cautious === totals.optimistic ? TIERS.filter((option) => option === tier) : TIERS).map((option) => (
              <label key={option} className={`tier tier-${option} ${option === tier ? 'on' : ''}`}>
                <input type="radio" name="tier" checked={option === tier} onChange={() => onTier(option)} />
                <span className="tier-name">{t(totals.cautious === totals.optimistic ? 'totalSingle' : (`tier_${option}` as Key))}</span>
                <strong>{money(totals[option], estimate.currency, lang)}</strong>
              </label>
            ))}
          </fieldset>

          <div className="letter-lang" role="group" aria-label={t('letterLang')}>
            <span>{t('letterLang')}</span>
            {(['en', 'pl'] as Lang[]).map((l) => (
              <button key={l} type="button" className={l === letterLang ? 'on' : ''} aria-pressed={l === letterLang} onClick={() => setLetterLang(l)}>
                {l === 'en' ? 'English' : 'Polski'}
              </button>
            ))}
          </div>

          <h3>{t('letterDetails')}</h3>
          <p className="help">{t('letterDetailsHelp')}</p>
          <div className="fields">
            {field('name', t('fName'))}
            {field('insurer', t('fInsurer'))}
            {field('claimNumber', t('fClaim'))}
          </div>

          <textarea className="letter" rows={22} value={text} onChange={(e) => setText(e.target.value)} spellCheck />

          <p className="help no-print">{t('polishHelp')}</p>
          <div className="row no-print">
            <span className="tone-label">{busy ? t('polishing') : t('polish')}</span>
            {(['firmer', 'friendlier', 'shorter'] as Tone[]).map((tone) => (
              <button key={tone} type="button" className="btn btn-primary" onClick={() => void polish(tone)} disabled={busy || !firebaseConfigured}>
                {t(`tone_${tone}` as Key)}
              </button>
            ))}
            {rewrite && rewrite.draft === draft && (
              <button type="button" className="btn btn-quiet" onClick={() => setRewrite(null)}>
                {t('resetLetter')}
              </button>
            )}
            <button type="button" className="btn" onClick={() => void copy()}>
              {copied ? t('copied') : t('copy')}
            </button>
            <button type="button" className="btn" onClick={download}>
              {t('download')}
            </button>
            <button type="button" className="btn" onClick={() => window.print()}>
              {t('print')}
            </button>
          </div>
          {busy && live && <pre className="live" aria-live="off">{live}</pre>}
          {message && (
            <p className={message.kind === 'ok' ? 'success' : 'error'} role="status">
              {message.text}
            </p>
          )}
          {discarded && (
            <details className="raw no-print">
              <summary>{t('polishDiscarded')}</summary>
              <pre className="live">{discarded}</pre>
            </details>
          )}
          <pre className="print-only">{text}</pre>
        </>
      )}
    </section>
  );
}
