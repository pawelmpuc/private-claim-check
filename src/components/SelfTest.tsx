import { useEffect, useState } from 'react';
import { cloudProbe, deviceStatus, downloadDeviceModel, isNativeApp, nativeProbe, nativeSelfTestDone, run, tuning } from '../lib/ai';
import { explainPrompt, inventedFigure } from '../lib/explain';
import { sampleEstimate } from '../lib/sample';

interface Line {
  step: string;
  result: string;
  ok: boolean | null;
}

/**
 * Opened with `?selftest`. Runs the on-device path end to end without any tapping and
 * writes each result on the page and to the console, so a run on a device farm (or by a
 * judge) leaves a record: is the model there, can it be downloaded, does it answer, and
 * does the answer pass the figure check. The Android app opens this by itself when it
 * runs in Firebase Test Lab.
 */
export function SelfTest() {
  const [lines, setLines] = useState<Line[]>([]);

  useEffect(() => {
    let stop = false;
    const say = (step: string, result: string, ok: boolean | null) => {
      console.log(`[PCC selftest] ${step}: ${result}`);
      if (!stop) setLines((old) => [...old.filter((l) => l.step !== step), { step, result, ok }]);
    };
    const test = async () => {
      say('Platform', isNativeApp ? 'Android app, Firebase AI Logic Android SDK' : 'Browser, Firebase AI Logic web SDK', null);
      const began = Date.now();
      let status = await deviceStatus('en');
      say('On-device model', status, status !== 'unavailable');
      // A phone that was reset a moment ago may need time before its AI service is set up.
      // `?selftest&wait=600` keeps asking for up to that many seconds.
      const waitMs = Math.min(Number(new URLSearchParams(location.search).get('wait')) || 0, 3600) * 1000;
      while (status === 'unavailable' && !stop && Date.now() - began < waitMs) {
        await new Promise((resolve) => setTimeout(resolve, 20_000));
        status = await deviceStatus('en');
        say('On-device model', `${status} after ${Math.round((Date.now() - began) / 1000)} s`, status !== 'unavailable');
      }
      if (status === 'downloadable' || status === 'downloading') {
        try {
          await downloadDeviceModel((fraction) => say('Download', `${Math.round(fraction * 100)}%`, null));
          say('Download', 'finished', true);
        } catch (err) {
          say('Download', err instanceof Error ? err.message : String(err), false);
        }
        status = await deviceStatus('en');
        say('On-device model after download', status, status === 'available');
      }
      if (status !== 'available') {
        say('On-device request', 'skipped: the model is not available on this device', null);
        if (isNativeApp) say('What the SDK reported', await nativeProbe(), null);
        return;
      }
      const prompt = explainPrompt(sampleEstimate(), 'en');
      const started = Date.now();
      try {
        const res = await run({ deviceParts: [prompt], cloudParts: [prompt], allowCloud: false, only: 'device', onText: (text) => say('On-device request', `writing… ${text.length} characters`, null) });
        const seconds = Math.round((Date.now() - started) / 1000);
        say('On-device request', `answered in ${seconds} s, ran ${res.source === 'on_device' ? 'on this device' : 'in the cloud'}`, res.source === 'on_device');
        const invented = inventedFigure(prompt, res.text);
        say('Figure check', invented ? `rejected, invented figure ${invented}` : 'passed: every figure is in the estimate', !invented);
        say('Answer', res.text.trim(), null);
      } catch (err) {
        say('On-device request', `failed: ${err instanceof Error ? err.message : String(err)}`, false);
      }
    };
    // `?selftest&cloud=1` also sends the built-in sample estimate (an invented document) to the
    // cloud model, to show the other half of the hybrid on a phone that has no on-device model.
    const cloudTest = async () => {
      const prompt = explainPrompt(sampleEstimate(), 'en');
      const started = Date.now();
      try {
        const res = await run({ deviceParts: [prompt], cloudParts: [prompt], allowCloud: true, only: 'cloud', onText: (text) => say('Cloud request', `writing… ${text.length} characters`, null) });
        const seconds = Math.round((Date.now() - started) / 1000);
        say('Cloud request', `answered in ${seconds} s, ran ${res.source === 'in_cloud' ? 'in the cloud' : 'on this device'}`, res.source === 'in_cloud');
        const invented = inventedFigure(prompt, res.text);
        say('Cloud figure check', invented ? `rejected, invented figure ${invented}` : 'passed: every figure is in the estimate', !invented);
        say('Cloud answer', res.text.trim(), null);
      } catch (err) {
        say('Cloud request', `failed: ${err instanceof Error ? err.message : String(err)}`, false);
      }
      // The backup model takes over when the first one's daily allowance is used up. Check that it answers.
      const backupStarted = Date.now();
      try {
        const text = await cloudProbe(tuning.cloudModelBackup, prompt);
        const invented = inventedFigure(prompt, text);
        say('Backup cloud model', `${tuning.cloudModelBackup} answered in ${Math.round((Date.now() - backupStarted) / 1000)} s; figure check ${invented ? `rejected ${invented}` : 'passed'}`, !invented);
      } catch (err) {
        say('Backup cloud model', `${tuning.cloudModelBackup} failed: ${err instanceof Error ? err.message : String(err)}`, false);
      }
    };
    const withCloud = new URLSearchParams(location.search).has('cloud');
    void test().then(() => (withCloud ? cloudTest() : undefined)).finally(() => {
      say('Self-test', 'finished', null);
      nativeSelfTestDone();
    });
    return () => {
      stop = true;
    };
  }, []);

  return (
    <section className="card selftest" aria-labelledby="selftest-title">
      <h2 id="selftest-title">On-device self-test</h2>
      <p className="help">
        Runs by itself.{' '}
        {new URLSearchParams(location.search).has('cloud') ? 'The cloud step sends only the built-in sample estimate, an invented document.' : 'Nothing is sent to the cloud in this test.'}
      </p>
      <dl>
        {lines.map((line) => (
          <div key={line.step} className={line.ok == null ? '' : line.ok ? 'pass' : 'fail'}>
            <dt>{line.step}</dt>
            <dd>{line.result}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
