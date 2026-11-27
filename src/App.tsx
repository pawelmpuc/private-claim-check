import { useCallback, useEffect, useMemo, useState } from 'react';
import { PrivacyPanel } from './components/PrivacyPanel';
import { StepAdd } from './components/StepAdd';
import { StepCompare } from './components/StepCompare';
import { StepFindings } from './components/StepFindings';
import { StepLetter } from './components/StepLetter';
import { StepReview } from './components/StepReview';
import { deviceStatus, type DeviceStatus } from './lib/ai';
import { audit, defaultSettings } from './lib/audit';
import { compareQuote } from './lib/compare';
import { countryByCode, countryForCurrency } from './lib/countries';
import { SelfTest } from './components/SelfTest';
import { detectLang, translate } from './lib/i18n';
import type { AuditSettings, Estimate, InferenceLogEntry, Lang, Tier } from './lib/types';
import { LangContext } from './lib/useT';

/** `?selftest` runs the on-device path by itself and writes the results on the page. */
const SELF_TEST = typeof location !== 'undefined' && new URLSearchParams(location.search).has('selftest');

export function App() {
  const [lang, setLang] = useState<Lang>(detectLang);
  const [allowCloud, setAllowCloud] = useState(false);
  const [device, setDevice] = useState<DeviceStatus>('unavailable');
  const [log, setLog] = useState<InferenceLogEntry[]>([]);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [country, setCountry] = useState<string>(() => (detectLang() === 'pl' ? 'PL' : 'GB'));
  const [settings, setSettings] = useState<AuditSettings>(() => defaultSettings('EUR'));
  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  const [tier, setTier] = useState<Tier>('realistic');
  const [rawRead, setRawRead] = useState<string | null>(null);
  const [rawFromPdf, setRawFromPdf] = useState(false);
  const [quoteFromPdf, setQuoteFromPdf] = useState(false);
  const [quote, setQuote] = useState<Estimate | null>(null);
  const [quoteRaw, setQuoteRaw] = useState<string | null>(null);

  const refreshDevice = useCallback(() => {
    void deviceStatus().then(setDevice);
  }, []);
  useEffect(refreshDevice, [refreshDevice]);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = translate(lang, 'appName');
  }, [lang]);

  const addLog = useCallback((entry: Omit<InferenceLogEntry, 'at'>) => {
    setLog((prev) => [...prev, { ...entry, at: Date.now() }]);
  }, []);

  const loadEstimate = useCallback(
    (next: Estimate, raw?: string, fromPdf?: boolean) => {
      setRawRead(raw ?? null);
      setRawFromPdf(Boolean(fromPdf));
      const code = countryForCurrency(next.currency, country);
      setCountry(code);
      setEstimate(next);
      setSettings(defaultSettings(next.currency, countryByCode(code).vat));
      setDeselected(new Set());
    },
    [country],
  );

  const changeCurrency = useCallback((currency: string) => {
    setEstimate((prev) => (prev ? { ...prev, currency } : prev));
    setSettings((prev) => ({ ...defaultSettings(currency, prev.vatRatePct), totalIsNet: prev.totalIsNet, claimantDeductsVat: prev.claimantDeductsVat }));
  }, []);

  const changeCountry = useCallback((code: string) => {
    const next = countryByCode(code);
    setCountry(code);
    setEstimate((prev) => (prev ? { ...prev, currency: next.currency } : prev));
    setSettings((prev) => ({ ...defaultSettings(next.currency, next.vat), totalIsNet: prev.totalIsNet, claimantDeductsVat: prev.claimantDeductsVat }));
  }, []);

  const comparison = useMemo(() => (estimate && quote ? compareQuote(estimate, quote) : null), [estimate, quote]);
  const findings = useMemo(() => (estimate ? audit(estimate, settings, comparison) : []), [estimate, settings, comparison]);
  const selected = useMemo(() => new Set(findings.map((f) => f.id).filter((id) => !deselected.has(id))), [findings, deselected]);

  const toggle = (id: string) =>
    setDeselected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const t = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) => translate(lang, key, params);

  // The self-test stands alone: on a device farm a crawler taps whatever it finds, and a tap
  // that sends the app to the background would stop an on-device request.
  if (SELF_TEST) {
    return (
      <LangContext.Provider value="en">
        <header className="top">
          <div className="wrap top-row">
            <div>
              <h1>{translate('en', 'appName')}</h1>
              <p className="tagline">{navigator.userAgent}</p>
            </div>
          </div>
        </header>
        <main className="wrap">
          <SelfTest />
        </main>
      </LangContext.Provider>
    );
  }

  return (
    <LangContext.Provider value={lang}>
      <header className="top">
        <div className="wrap top-row">
          <div>
            <h1>{t('appName')}</h1>
            <p className="tagline">{t('tagline')}</p>
          </div>
          <div className="lang" role="group" aria-label={t('langLabel')}>
            {(['en', 'pl'] as Lang[]).map((l) => (
              <button key={l} type="button" className={l === lang ? 'on' : ''} aria-pressed={l === lang} onClick={() => setLang(l)}>
                {l.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="wrap">
        <PrivacyPanel device={device} onDeviceChange={refreshDevice} allowCloud={allowCloud} onAllowCloud={setAllowCloud} log={log} />

        <StepAdd allowCloud={allowCloud} fallbackCurrency={countryByCode(country).currency} onEstimate={loadEstimate} onLog={addLog} hasEstimate={estimate != null} onReset={() => { setEstimate(null); setQuote(null); }} />

        {estimate && (
          <>
            <StepReview estimate={estimate} onChange={setEstimate} onCurrency={changeCurrency} country={country} onCountry={changeCountry} settings={settings} onSettings={setSettings} rawRead={rawRead} rawFromPdf={rawFromPdf} allowCloud={allowCloud} onLog={addLog} />
            <StepAdd
              variant="quote"
              allowCloud={allowCloud}
              fallbackCurrency={estimate.currency}
              onEstimate={(next, raw, fromPdf) => {
                setQuote(next);
                setQuoteRaw(raw ?? null);
                setQuoteFromPdf(Boolean(fromPdf));
              }}
              onLog={addLog}
              hasEstimate={quote != null}
              onReset={() => setQuote(null)}
            />
            {quote && comparison && <StepCompare estimate={estimate} quote={quote} onQuote={setQuote} comparison={comparison} rawRead={quoteRaw} rawFromPdf={quoteFromPdf} />}
            <StepFindings estimate={estimate} findings={findings} selected={selected} onToggle={toggle} />
            <StepLetter estimate={estimate} findings={findings} selected={selected} comparison={comparison && comparison.gap > 0 ? comparison : null} tier={tier} onTier={setTier} allowCloud={allowCloud} onLog={addLog} />
          </>
        )}

        <p className="disclaimer">{t('disclaimer')}</p>
      </main>

      <footer className="wrap foot">
        <p>{t('footerPrivacy')}</p>
        <p>{t('footerOpen')}</p>
      </footer>
    </LangContext.Provider>
  );
}
