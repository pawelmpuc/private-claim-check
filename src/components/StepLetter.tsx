import { useEffect, useMemo, useState } from 'react';
import { CloudNotAllowedError, firebaseConfigured, NotConfiguredError, run } from '../lib/ai';
import { TIERS, tierTotals } from '../lib/audit';
import type { Key } from '../lib/i18n';
import { draftLetter, fillDetails, money, POLISH_PROMPT, verifyRewrite, type LetterDetails } from '../lib/letter';
import { redact } from '../lib/redact';
import type { Estimate, Finding, InferenceLogEntry, Tier } from '../lib/types';
import { useT } from '../lib/useT';

interface Props {
  estimate: Estimate;
  findings: Finding[];
  selected: Set<string>;
  tier: Tier;
  onTier: (tier: Tier) => void;
  allowCloud: boolean;
  onLog: (entry: Omit<InferenceLogEntry, 'at'>) => void;
}

export function StepLetter({ estimate, findings, selected, tier, onTier, allowCloud, onLog }: Props) {
  const { t, lang } = useT();
  const [details, setDetails] = useState<LetterDetails>({ name: '', insurer: '', claimNumber: '' });
  const [rewrite, setRewrite] = useState<{ draft: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const draft = useMemo(() => draftLetter(estimate, findings, selected, tier, lang), [estimate, findings, selected, tier, lang]);
  const totals = tierTotals(findings, selected);
  // A rewrite is only valid for the exact draft it was made from.
  const body = rewrite && rewrite.draft === draft ? rewrite.text : draft;
  const [text, setText] = useState('');
  useEffect(() => setText(fillDetails(body, details, lang)), [body, details, lang]);
  useEffect(() => setMessage(null), [draft]);

  const polish = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const prompt = POLISH_PROMPT[lang] + draft;
      const safe = redact(prompt);
      const res = await run({ deviceParts: [prompt], cloudParts: [safe.text], allowCloud, outputLang: lang });
      onLog({ step: 'letter', source: res.source, redactions: res.source === 'in_cloud' ? safe.count : 0, note: res.deviceError ? 'device_failed' : undefined });
      const candidate = res.text.trim();
      if (verifyRewrite(draft, candidate).ok) {
        setRewrite({ draft, text: candidate });
        setMessage({ kind: 'ok', text: t('polishOk', { where: t(res.source === 'on_device' ? 'srcDevice' : 'srcCloud') }) });
      } else {
        setRewrite(null);
        setMessage({ kind: 'error', text: t('polishRejected') });
      }
    } catch (err) {
      if (err instanceof CloudNotAllowedError) setMessage({ kind: 'error', text: t('errCloudNotAllowed') });
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
    a.download = lang === 'pl' ? 'odwolanie.txt' : 'appeal-letter.txt';
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
            {TIERS.map((option) => (
              <label key={option} className={`tier tier-${option} ${option === tier ? 'on' : ''}`}>
                <input type="radio" name="tier" checked={option === tier} onChange={() => onTier(option)} />
                <span className="tier-name">{t(`tier_${option}` as Key)}</span>
                <strong>{money(totals[option], estimate.currency, lang)}</strong>
              </label>
            ))}
          </fieldset>

          <h3>{t('letterDetails')}</h3>
          <p className="help">{t('letterDetailsHelp')}</p>
          <div className="fields">
            {field('name', t('fName'))}
            {field('insurer', t('fInsurer'))}
            {field('claimNumber', t('fClaim'))}
          </div>

          <textarea className="letter" rows={22} value={text} onChange={(e) => setText(e.target.value)} spellCheck />

          <div className="row no-print">
            <button type="button" className="btn btn-primary" onClick={() => void polish()} disabled={busy || !firebaseConfigured}>
              {busy ? t('polishing') : t('polish')}
            </button>
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
          {message && (
            <p className={message.kind === 'ok' ? 'success' : 'error'} role="status">
              {message.text}
            </p>
          )}
          <pre className="print-only">{text}</pre>
        </>
      )}
    </section>
  );
}
