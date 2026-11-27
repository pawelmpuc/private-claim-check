import { useEffect, useState } from 'react';
import { CloudNotAllowedError, DeviceTimeoutError, firebaseConfigured, NotConfiguredError, run, tuning } from '../lib/ai';
import { explainPrompt, inventedFigure } from '../lib/explain';
import type { Estimate, InferenceLogEntry } from '../lib/types';
import { useT } from '../lib/useT';

interface Props {
  estimate: Estimate;
  allowCloud: boolean;
  onLog: (entry: Omit<InferenceLogEntry, 'at'>) => void;
}

/** A plain-language reading of the estimate, written by the model from the lines alone. */
export function Explain({ estimate, allowCloud, onLog }: Props) {
  const { t, lang } = useT();
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState('');
  const [result, setResult] = useState<{ text: string; where: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // An explanation belongs to the lines it was written from.
  useEffect(() => {
    setResult(null);
    setError(null);
  }, [estimate, lang]);

  const explain = async () => {
    setBusy(true);
    setLive('');
    setResult(null);
    setError(null);
    try {
      const prompt = explainPrompt(estimate, lang);
      const res = await run({ deviceParts: [prompt], cloudParts: [prompt], allowCloud, outputLang: lang, onText: setLive });
      onLog({ step: 'explain', source: res.source, redactions: 0, note: res.deviceError ? 'device_failed' : undefined });
      const text = res.text.trim();
      const invented = inventedFigure(prompt, text);
      if (invented) setError(t('explainRejected', { value: invented }));
      else setResult({ text, where: t(res.source === 'on_device' ? 'srcDevice' : 'srcCloud') });
    } catch (err) {
      if (err instanceof DeviceTimeoutError) setError(t('errDeviceTimeout', { s: tuning.deviceTimeoutS }));
      else if (err instanceof CloudNotAllowedError) setError(t('errCloudNotAllowed'));
      else if (err instanceof NotConfiguredError) setError(t('errNotConfigured'));
      else setError(t('errGeneric', { msg: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="explain">
      <h3>{t('explainTitle')}</h3>
      <p className="help">{t('explainHelp')}</p>
      <button type="button" className="btn" onClick={() => void explain()} disabled={busy || !firebaseConfigured || estimate.items.length === 0}>
        {busy ? t('explaining') : t('explainButton')}
      </button>
      {busy && live && <p className="explain-text live-text">{live}</p>}
      {result && (
        <>
          <p className="explain-text">{result.text}</p>
          <p className="success" role="status">
            {t('explainDone', { where: result.where })}
          </p>
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
