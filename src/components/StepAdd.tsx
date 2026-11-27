import { useRef, useState } from 'react';
import { CloudNotAllowedError, DEVICE_START_TIMEOUT_S, deviceStatus, DeviceTimeoutError, firebaseConfigured, imagePart, NotConfiguredError, run } from '../lib/ai';
import { emptyItem, mergeEstimates, normalizeEstimate, parseModelJson, parseTranscription, READ_PROMPT, TRANSCRIBE_PROMPT, TRANSCRIBE_TEXT_PROMPT } from '../lib/extract';
import { filesToPages, MAX_PAGES, tilesOf, type PageImage } from '../lib/files';
import { redact } from '../lib/redact';
import { sampleEstimate } from '../lib/sample';
import type { Estimate, InferenceLogEntry } from '../lib/types';
import { useT } from '../lib/useT';

interface Props {
  allowCloud: boolean;
  hasEstimate: boolean;
  /** Currency assumed when the on-device transcription does not name one. */
  fallbackCurrency: string;
  onEstimate: (estimate: Estimate, raw?: string) => void;
  onLog: (entry: Omit<InferenceLogEntry, 'at'>) => void;
  onReset: () => void;
}

export function StepAdd({ allowCloud, hasEstimate, fallbackCurrency, onEstimate, onLog, onReset }: Props) {
  const { t } = useT();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pages, setPages] = useState<PageImage[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState('');
  const abort = useRef<AbortController | null>(null);

  const fail = (err: unknown) => {
    if (abort.current?.signal.aborted) return;
    if (err instanceof DeviceTimeoutError) setError(t('errDeviceTimeout', { s: DEVICE_START_TIMEOUT_S }));
    else if (err instanceof CloudNotAllowedError) setError(t('errCloudNotAllowed'));
    else if (err instanceof NotConfiguredError) setError(t('errNotConfigured'));
    else setError(t('errGeneric', { msg: err instanceof Error ? err.message : String(err) }));
  };

  const begin = () => {
    setError(null);
    setLive('');
    raw.current = [];
    abort.current = new AbortController();
    return abort.current.signal;
  };

  const end = () => {
    setBusy(null);
    setLive('');
  };

  const raw = useRef<string[]>([]);

  const finish = (estimate: Estimate) => {
    if (estimate.items.length === 0) setError(t('errNoLines'));
    else onEstimate(estimate, raw.current.length > 0 ? raw.current.join('\n\n') : undefined);
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

  /**
   * Reads one unit of work, a page image or the pasted text.
   * On the device the page is transcribed tile by tile and structured in code;
   * in the cloud the whole page is read in one JSON request.
   */
  const readOne = async (device: () => Promise<string[]>, cloud: (note?: 'device_failed') => Promise<Estimate>): Promise<Estimate> => {
    let deviceFailed = false;
    if ((await deviceStatus()) === 'available') {
      try {
        const texts = await device();
        raw.current.push(...texts);
        const estimate = parseTranscription(texts, fallbackCurrency);
        onLog({ step: 'read', source: 'on_device', redactions: 0 });
        return estimate;
      } catch (err) {
        if (abort.current?.signal.aborted || !allowCloud) throw err;
        deviceFailed = true;
      }
    }
    if (!allowCloud) throw new CloudNotAllowedError();
    setLive('');
    return cloud(deviceFailed ? 'device_failed' : undefined);
  };

  const readPages = async () => {
    const signal = begin();
    try {
      const results: Estimate[] = [];
      for (let n = 0; n < pages.length; n += 1) {
        const page = pages[n];
        setBusy(t('reading', { a: n + 1, b: pages.length }));
        setLive('');
        const estimate = await readOne(
          async () => {
            const tiles = await tilesOf(page);
            // ?debug keeps the tiles on window so prompts can be tried against the same images.
            if (new URLSearchParams(location.search).has('debug')) (window as unknown as { pccTiles: PageImage[] }).pccTiles = tiles;
            const texts: string[] = [];
            for (let k = 0; k < tiles.length; k += 1) {
              setBusy(t('readingTile', { a: n + 1, b: pages.length, k: k + 1, n: tiles.length }));
              const done = texts.join('\n');
              const res = await run({
                only: 'device',
                deviceParts: [TRANSCRIBE_PROMPT, imagePart(tiles[k].base64, tiles[k].mimeType)],
                cloudParts: [],
                allowCloud: false,
                onText: (text) => setLive(done ? `${done}\n${text}` : text),
                signal,
              });
              texts.push(res.text);
            }
            return texts;
          },
          async (note) => {
            const res = await run({ only: 'cloud', deviceParts: [], cloudParts: [READ_PROMPT, imagePart(page.base64, page.mimeType)], allowCloud: true, cloudJson: true, signal });
            onLog({ step: 'read', source: res.source, redactions: 0, note });
            return normalizeEstimate(parseModelJson(res.text));
          },
        );
        results.push(estimate);
      }
      finish(mergeEstimates(results));
    } catch (err) {
      fail(err);
    } finally {
      end();
    }
  };

  const readText = async () => {
    const signal = begin();
    setBusy(t('readingText'));
    try {
      const estimate = await readOne(
        async () => {
          const res = await run({ only: 'device', deviceParts: [`${TRANSCRIBE_TEXT_PROMPT}\n\nTEXT:\n${text}`], cloudParts: [], allowCloud: false, onText: setLive, signal });
          return [res.text];
        },
        async (note) => {
          const safe = redact(text);
          const res = await run({ only: 'cloud', deviceParts: [], cloudParts: [`${READ_PROMPT}\n\nDOCUMENT:\n${safe.text}`], allowCloud: true, cloudJson: true, signal });
          onLog({ step: 'read', source: res.source, redactions: safe.count, note });
          return normalizeEstimate(parseModelJson(res.text));
        },
      );
      finish(estimate);
    } catch (err) {
      fail(err);
    } finally {
      end();
    }
  };

  const manual = () => onEstimate({ currency: 'EUR', labourRate: null, paintRate: null, statedTotal: null, items: [emptyItem()] });

  const reset = () => {
    abort.current?.abort();
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
        <div role="status">
          <p className="busy">
            <span className="spinner" aria-hidden="true" />
            {busy}
            <button type="button" className="btn btn-quiet" onClick={() => abort.current?.abort()}>
              {t('stop')}
            </button>
          </p>
          {live && <pre className="live">{live}</pre>}
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
