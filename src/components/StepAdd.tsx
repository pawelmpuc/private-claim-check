import { useRef, useState } from 'react';
import { CloudNotAllowedError, firebaseConfigured, imagePart, NotConfiguredError, run } from '../lib/ai';
import { emptyItem, ESTIMATE_JSON_SCHEMA, mergeEstimates, normalizeEstimate, parseModelJson, READ_PROMPT } from '../lib/extract';
import { filesToPages, MAX_PAGES, type PageImage } from '../lib/files';
import { redact } from '../lib/redact';
import { sampleEstimate } from '../lib/sample';
import type { Estimate, InferenceLogEntry } from '../lib/types';
import { useT } from '../lib/useT';

interface Props {
  allowCloud: boolean;
  hasEstimate: boolean;
  onEstimate: (estimate: Estimate) => void;
  onLog: (entry: Omit<InferenceLogEntry, 'at'>) => void;
  onReset: () => void;
}

export function StepAdd({ allowCloud, hasEstimate, onEstimate, onLog, onReset }: Props) {
  const { t } = useT();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pages, setPages] = useState<PageImage[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fail = (err: unknown) => {
    if (err instanceof CloudNotAllowedError) setError(t('errCloudNotAllowed'));
    else if (err instanceof NotConfiguredError) setError(t('errNotConfigured'));
    else setError(t('errGeneric', { msg: err instanceof Error ? err.message : String(err) }));
  };

  const finish = (estimate: Estimate) => {
    if (estimate.items.length === 0) setError(t('errNoLines'));
    else onEstimate(estimate);
  };

  const pickFiles = async (files: FileList | null) => {
    setError(null);
    if (!files || files.length === 0) return;
    try {
      setPages(await filesToPages(Array.from(files)));
    } catch (err) {
      fail(err);
    }
  };

  const readPages = async () => {
    setError(null);
    try {
      const results: Estimate[] = [];
      for (let n = 0; n < pages.length; n += 1) {
        setBusy(t('reading', { a: n + 1, b: pages.length }));
        const parts = [READ_PROMPT, imagePart(pages[n].base64, pages[n].mimeType)];
        const res = await run({ deviceParts: parts, cloudParts: parts, allowCloud, jsonSchema: ESTIMATE_JSON_SCHEMA });
        onLog({ step: 'read', source: res.source, redactions: 0, note: res.deviceError ? 'device_failed' : undefined });
        results.push(normalizeEstimate(parseModelJson(res.text)));
      }
      finish(mergeEstimates(results));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const readText = async () => {
    setError(null);
    setBusy(t('readingText'));
    try {
      const safe = redact(text);
      const res = await run({
        deviceParts: [`${READ_PROMPT}\n\nDOCUMENT:\n${text}`],
        cloudParts: [`${READ_PROMPT}\n\nDOCUMENT:\n${safe.text}`],
        allowCloud,
        jsonSchema: ESTIMATE_JSON_SCHEMA,
      });
      onLog({ step: 'read', source: res.source, redactions: res.source === 'in_cloud' ? safe.count : 0, note: res.deviceError ? 'device_failed' : undefined });
      finish(normalizeEstimate(parseModelJson(res.text)));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const manual = () => onEstimate({ currency: 'EUR', labourRate: null, paintRate: null, statedTotal: null, items: [emptyItem()] });

  const reset = () => {
    setPages([]);
    setText('');
    setError(null);
    if (fileInput.current) fileInput.current.value = '';
    onReset();
  };

  return (
    <section className="card" aria-labelledby="step1">
      <div className="card-head">
        <h2 id="step1">{t('step1')}</h2>
        {hasEstimate && (
          <button type="button" className="btn btn-quiet" onClick={reset}>
            {t('startOver')}
          </button>
        )}
      </div>

      <p className="help">{t('uploadHint', { n: MAX_PAGES })}</p>
      <input ref={fileInput} id="files" className="sr-only" type="file" accept="image/*,application/pdf" multiple onChange={(e) => void pickFiles(e.target.files)} />
      <div className="row">
        <label htmlFor="files" className="btn btn-primary">
          {t('chooseFiles')}
        </label>
        <button type="button" className="btn" onClick={() => onEstimate(sampleEstimate())}>
          {t('loadSample')}
        </button>
        <button type="button" className="btn btn-quiet" onClick={manual}>
          {t('typeManually')}
        </button>
      </div>

      {pages.length > 0 && (
        <div className="pages">
          <p>{t('pagesReady', { n: pages.length })}</p>
          <div className="thumbs">
            {pages.map((p, n) => (
              <img key={n} src={p.previewUrl} alt="" />
            ))}
          </div>
          <button type="button" className="btn btn-primary" onClick={() => void readPages()} disabled={busy != null || !firebaseConfigured}>
            {t('readPages')}
          </button>
        </div>
      )}

      <details className="paste">
        <summary>{t('orPaste')}</summary>
        <textarea rows={6} value={text} placeholder={t('pastePlaceholder')} onChange={(e) => setText(e.target.value)} />
        <button type="button" className="btn" onClick={() => void readText()} disabled={busy != null || text.trim().length < 20 || !firebaseConfigured}>
          {t('readText')}
        </button>
      </details>

      {busy && (
        <p className="busy" role="status">
          <span className="spinner" aria-hidden="true" />
          {busy}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
