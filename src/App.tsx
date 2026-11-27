import { useCallback, useEffect, useMemo, useState } from 'react';
import { PrivacyPanel } from './components/PrivacyPanel';
import { StepAdd } from './components/StepAdd';
import { StepFindings } from './components/StepFindings';
import { StepLetter } from './components/StepLetter';
import { StepReview } from './components/StepReview';
import { deviceStatus, type DeviceStatus } from './lib/ai';
import { audit, defaultSettings } from './lib/audit';
import { countryByCode, countryForCurrency } from './lib/countries';
import { detectLang, translate } from './lib/i18n';
import type { AuditSettings, Estimate, InferenceLogEntry, Lang, Tier } from './lib/types';
import { LangContext } from './lib/useT';

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
    (next: Estimate, raw?: string) => {
      setRawRead(raw ?? null);
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

  const findings = useMemo(() => (estimate ? audit(estimate, settings) : []), [estimate, settings]);
  const selected = useMemo(() => new Set(findings.map((f) => f.id).filter((id) => !deselected.has(id))), [findings, deselected]);

  const toggle = (id: string) =>
    setDeselected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const t = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) => translate(lang, key, params);

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

        <StepAdd allowCloud={allowCloud} onEstimate={loadEstimate} onLog={addLog} hasEstimate={estimate != null} onReset={() => setEstimate(null)} />

        {estimate && (
          <>
            <StepReview estimate={estimate} onChange={setEstimate} onCurrency={changeCurrency} country={country} onCountry={changeCountry} settings={settings} onSettings={setSettings} rawRead={rawRead} />
            <StepFindings estimate={estimate} findings={findings} selected={selected} onToggle={toggle} />
            <StepLetter estimate={estimate} findings={findings} selected={selected} tier={tier} onTier={setTier} allowCloud={allowCloud} onLog={addLog} />
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
