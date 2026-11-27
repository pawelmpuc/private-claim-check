import { useState } from 'react';
import { downloadDeviceModel, firebaseConfigured, type DeviceStatus } from '../lib/ai';
import type { Key } from '../lib/i18n';
import type { InferenceLogEntry } from '../lib/types';
import { useT } from '../lib/useT';

interface Props {
  device: DeviceStatus;
  onDeviceChange: () => void;
  allowCloud: boolean;
  onAllowCloud: (value: boolean) => void;
  log: InferenceLogEntry[];
}

const STATUS_KEY: Record<DeviceStatus, Key> = {
  available: 'deviceAvailable',
  downloadable: 'deviceDownloadable',
  downloading: 'deviceDownloading',
  unavailable: 'deviceUnavailable',
};

const SOURCE_KEY = { on_device: 'srcDevice', in_cloud: 'srcCloud', none: 'srcNone' } as const;

export function PrivacyPanel({ device, onDeviceChange, allowCloud, onAllowCloud, log }: Props) {
  const { t, lang } = useT();
  const [progress, setProgress] = useState<number | null>(null);

  const download = async () => {
    setProgress(0);
    try {
      await downloadDeviceModel((fraction) => setProgress(Math.round(fraction * 100)));
    } finally {
      setProgress(null);
      onDeviceChange();
    }
  };

  return (
    <section className="card privacy" aria-labelledby="privacy-title">
      <h2 id="privacy-title">{t('privacyTitle')}</h2>
      <div className="privacy-grid">
        <div>
          <p className={`chip chip-${device}`}>
            <span className="dot" aria-hidden="true" />
            {t(STATUS_KEY[device])}
          </p>
          {device === 'unavailable' && <p className="help">{t('deviceHelp')}</p>}
          {(device === 'downloadable' || device === 'downloading') && firebaseConfigured && (
            <button type="button" className="btn" onClick={download} disabled={progress != null}>
              {progress != null ? t('downloading', { pct: progress }) : t('downloadModel')}
            </button>
          )}
          <label className="switch">
            <input type="checkbox" checked={allowCloud} onChange={(e) => onAllowCloud(e.target.checked)} />
            <span>{t('allowCloud')}</span>
          </label>
          <p className="help">{t('allowCloudHelp')}</p>
          {!firebaseConfigured && <p className="notice">{t('notConfigured')}</p>}
        </div>
        <div>
          <h3>{t('logTitle')}</h3>
          {log.length === 0 ? (
            <p className="help">{t('logEmpty')}</p>
          ) : (
            <ul className="log">
              {log.map((entry) => (
                <li key={entry.at + entry.step}>
                  <time>{new Date(entry.at).toLocaleTimeString(lang === 'pl' ? 'pl-PL' : 'en-GB')}</time>
                  <span>{t(entry.step === 'read' ? 'logRead' : 'logLetter')}</span>
                  <span className={`chip chip-src-${entry.source}`}>
                    <span className="dot" aria-hidden="true" />
                    {t(SOURCE_KEY[entry.source])}
                  </span>
                  {entry.source === 'in_cloud' && entry.redactions > 0 && <small>{t('logRedactions', { n: entry.redactions })}</small>}
                  {entry.note === 'device_failed' && <small>{t('logDeviceFailed')}</small>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
