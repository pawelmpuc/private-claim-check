import { initializeApp, type FirebaseApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider, ReCaptchaV3Provider } from 'firebase/app-check';
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, type AI, type Part } from 'firebase/ai';
import { fetchAndActivate, getNumber, getRemoteConfig, getString } from 'firebase/remote-config';
import type { InferenceSource } from './types';

/**
 * Every model call in this app goes through Firebase AI Logic.
 *
 * Routing is explicit instead of PREFER_ON_DEVICE so that the app knows, before
 * anything is sent, whether a request will leave the device. That lets it redact
 * text first and refuse the cloud entirely when the user has not allowed it.
 */

export type DeviceStatus = 'available' | 'downloadable' | 'downloading' | 'unavailable';

export class NotConfiguredError extends Error {}
export class CloudNotAllowedError extends Error {}
export class DeviceTimeoutError extends Error {}

/**
 * Two settings can be changed from Firebase Remote Config without a new release:
 * the cloud model (model names are retired over time) and how long the on-device
 * model may take to produce its first text before the app gives up on it.
 * The values below are used until Remote Config answers, and whenever it does not.
 */
export const tuning = { cloudModel: 'gemini-3.5-flash-lite', deviceTimeoutS: 90 };

/** Remote values are checked before use, so a typo in the console cannot break the app. */
export function applyRemote(cloudModel: string, deviceTimeoutS: number): void {
  if (/^gemini-[a-z0-9.-]{3,40}$/.test(cloudModel)) tuning.cloudModel = cloudModel;
  if (Number.isFinite(deviceTimeoutS) && deviceTimeoutS >= 30 && deviceTimeoutS <= 300) tuning.deviceTimeoutS = Math.round(deviceTimeoutS);
}

function loadRemoteConfig(app: FirebaseApp): void {
  try {
    const rc = getRemoteConfig(app);
    rc.settings.minimumFetchIntervalMillis = 60 * 60 * 1000;
    rc.defaultConfig = { cloud_model: tuning.cloudModel, device_timeout_s: tuning.deviceTimeoutS };
    void fetchAndActivate(rc)
      .then(() => applyRemote(getString(rc, 'cloud_model'), getNumber(rc, 'device_timeout_s')))
      .catch(() => undefined);
  } catch {
    // Remote Config needs IndexedDB. Without it the defaults stay in force.
  }
}

const env = import.meta.env;

/**
 * Inside the Android app the page has no Firebase web SDK to talk to. The native side
 * exposes `PccNative`, and every model call goes through the Firebase AI Logic Android
 * SDK instead (android/app/src/main/java/.../AiBridge.kt). The routing below stays the
 * same: this file still decides whether a request may run on the device or in the cloud.
 */
interface NativeReply {
  id: string;
  ok?: boolean;
  error?: string;
  chunk?: string;
  progress?: number;
  status?: DeviceStatus;
  text?: string;
  source?: 'on_device' | 'in_cloud';
}
const nativeBridge = (globalThis as unknown as { PccNative?: { post(message: string): void } }).PccNative;
export const isNativeApp = Boolean(nativeBridge);
const nativePending = new Map<string, { resolve: (r: NativeReply) => void; reject: (e: Error) => void; onEvent?: (r: NativeReply) => void }>();
let nativeSeq = 0;

if (nativeBridge) {
  (globalThis as unknown as { __pccNativeReply: (json: string) => void }).__pccNativeReply = (json) => {
    const reply = JSON.parse(json) as NativeReply;
    const waiting = nativePending.get(reply.id);
    if (!waiting) return;
    if (reply.ok === undefined) return waiting.onEvent?.(reply);
    nativePending.delete(reply.id);
    if (reply.ok) waiting.resolve(reply);
    else waiting.reject(reply.error === 'not_configured' ? new NotConfiguredError('Firebase is not configured.') : new Error(reply.error ?? 'Native request failed.'));
  };
}

function nativeCall(op: string, payload: object, onEvent?: (r: NativeReply) => void, signal?: AbortSignal): Promise<NativeReply> {
  const id = `n${++nativeSeq}`;
  return new Promise((resolve, reject) => {
    nativePending.set(id, { resolve, reject, onEvent });
    signal?.addEventListener('abort', () => {
      if (!nativePending.delete(id)) return;
      nativeBridge!.post(JSON.stringify({ id, op: 'cancel' }));
      reject(new DOMException('Aborted', 'AbortError'));
    });
    nativeBridge!.post(JSON.stringify({ id, op, ...payload }));
  });
}

/** Debug builds of the Android app only: the App Check debug token to register in the Firebase console. */
export async function nativeDebugToken(): Promise<string> {
  if (!nativeBridge) return '';
  try {
    return (await nativeCall('debugToken', {})).text ?? '';
  } catch {
    return '';
  }
}

/** Text and images in the shape the native bridge takes. */
const nativeParts = (parts: Array<string | Part>) =>
  parts.map((part) => (typeof part === 'string' ? { text: part } : 'inlineData' in part ? { data: part.inlineData.data, mimeType: part.inlineData.mimeType } : { text: 'text' in part ? part.text : '' }));

export const firebaseConfigured = isNativeApp || Boolean(env.VITE_FIREBASE_API_KEY && env.VITE_FIREBASE_PROJECT_ID && env.VITE_FIREBASE_APP_ID);

let ai: AI | null = null;

function getAi(): AI {
  if (ai) return ai;
  if (!firebaseConfigured) throw new NotConfiguredError('Firebase is not configured.');
  const app: FirebaseApp = initializeApp({
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  });
  if (env.VITE_APPCHECK_DEBUG === 'true') {
    (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  }
  if (env.VITE_RECAPTCHA_ENTERPRISE_KEY) {
    initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(env.VITE_RECAPTCHA_ENTERPRISE_KEY), isTokenAutoRefreshEnabled: true });
  } else if (env.VITE_RECAPTCHA_V3_KEY) {
    initializeAppCheck(app, { provider: new ReCaptchaV3Provider(env.VITE_RECAPTCHA_V3_KEY), isTokenAutoRefreshEnabled: true });
  }
  ai = getAI(app, { backend: new GoogleAIBackend() });
  loadRemoteConfig(app);
  return ai;
}

/** Languages the caller wants from the on-device model. Chrome rejects languages it does not support. */
const deviceIo = (outputLang: string) => ({
  expectedInputs: [{ type: 'text' as const, languages: outputLang === 'en' ? ['en'] : ['en', outputLang] }, { type: 'image' as const }],
  expectedOutputs: [{ type: 'text' as const, languages: [outputLang] }],
});

interface LanguageModelGlobal {
  availability(options?: unknown): Promise<DeviceStatus>;
}

/** Asks Chrome whether the built-in model can run here. No data leaves the device. */
/**
 * `?nodevice` in the address makes the app behave like a browser without the on-device model.
 * It exists to test and show the cloud path on a machine that has the model.
 */
const FORCE_NO_DEVICE = typeof location !== 'undefined' && new URLSearchParams(location.search).has('nodevice');

export async function deviceStatus(outputLang = 'en'): Promise<DeviceStatus> {
  if (FORCE_NO_DEVICE) return 'unavailable';
  if (nativeBridge) {
    try {
      return (await nativeCall('status', {})).status ?? 'unavailable';
    } catch {
      return 'unavailable';
    }
  }
  const lm = (globalThis as unknown as { LanguageModel?: LanguageModelGlobal }).LanguageModel;
  if (!lm?.availability) return 'unavailable';
  try {
    return await lm.availability(deviceIo(outputLang));
  } catch {
    return 'unavailable';
  }
}

function model(mode: InferenceMode, outputLang = 'en', cloudJsonSchema?: object) {
  return getGenerativeModel(getAi(), {
    mode,
    onDeviceParams: { createOptions: deviceIo(outputLang) },
    inCloudParams: {
      // JSON mode keeps the reply parseable.
      model: tuning.cloudModel,
      generationConfig: cloudJsonSchema ? { responseMimeType: 'application/json', temperature: 0 } : { temperature: 0.3 },
    },
  });
}

/** Must be called from a click handler. Downloads the on-device model if Chrome has not done so yet. */
export async function downloadDeviceModel(onProgress: (fraction: number) => void): Promise<void> {
  if (nativeBridge) {
    await nativeCall('download', {}, (event) => event.progress != null && onProgress(event.progress));
    return;
  }
  await model(InferenceMode.ONLY_ON_DEVICE).initializeDeviceModel(onProgress);
}

export interface RunRequest {
  /** Sent when the request runs on the device. */
  deviceParts: Array<string | Part>;
  /** Sent when the request has to go to the cloud. Build it from redacted text. */
  cloudParts: Array<string | Part>;
  allowCloud: boolean;
  /** Force one path. The caller has then already decided where the request may run. */
  only?: 'device' | 'cloud';
  /** Ask the cloud model for JSON. The on-device prompt asks for its own format. */
  cloudJson?: boolean;
  /** Language of the reply. Defaults to English. */
  outputLang?: string;
  /** Called with the text so far while the on-device model writes. */
  onText?: (text: string) => void;
  signal?: AbortSignal;
}

export interface RunResult {
  text: string;
  source: Exclude<InferenceSource, 'none'>;
  /** Set when the device was tried first and failed. */
  deviceError?: string;
}

export async function run(req: RunRequest): Promise<RunResult> {
  let deviceError: string | undefined;
  const lang = req.outputLang ?? 'en';
  const options = req.signal ? { signal: req.signal } : undefined;
  let deviceTimedOut = false;
  const status = req.only === 'cloud' ? 'unavailable' : await deviceStatus(lang);
  if (status === 'available') {
    // A browser can report the model as available and still never start it, so the
    // device attempt is abandoned if no text arrives in time.
    const attempt = new AbortController();
    const forward = () => attempt.abort();
    req.signal?.addEventListener('abort', forward);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        deviceTimedOut = true;
        attempt.abort();
        reject(new DeviceTimeoutError(`No answer from the on-device model after ${tuning.deviceTimeoutS} seconds.`));
      }, tuning.deviceTimeoutS * 1000);
    });
    const stream = (async () => {
      if (nativeBridge) {
        let text = '';
        const done = await nativeCall('generate', { mode: 'device', model: tuning.cloudModel, parts: nativeParts(req.deviceParts) }, (event) => {
          if (event.chunk == null) return;
          clearTimeout(timer);
          text += event.chunk;
          req.onText?.(text);
        }, attempt.signal);
        return done.text ?? text;
      }
      const result = await model(InferenceMode.ONLY_ON_DEVICE, lang).generateContentStream(req.deviceParts, { signal: attempt.signal });
      let text = '';
      for await (const chunk of result.stream) {
        clearTimeout(timer);
        text += chunk.text();
        req.onText?.(text);
      }
      return text;
    })();
    stream.catch(() => undefined);
    try {
      return { text: await Promise.race([stream, timeout]), source: 'on_device' };
    } catch (err) {
      if (req.signal?.aborted) throw err;
      deviceError = err instanceof Error ? err.message : String(err);
    } finally {
      clearTimeout(timer);
      req.signal?.removeEventListener('abort', forward);
    }
  }
  if (!req.allowCloud || req.only === 'device') {
    if (deviceTimedOut) throw new DeviceTimeoutError(deviceError);
    throw new CloudNotAllowedError(deviceError ?? 'The on-device model is not available.');
  }
  if (nativeBridge) {
    const done = await nativeCall('generate', { mode: 'cloud', model: tuning.cloudModel, json: Boolean(req.cloudJson), parts: nativeParts(req.cloudParts) }, undefined, req.signal);
    return { text: done.text ?? '', source: done.source === 'on_device' ? 'on_device' : 'in_cloud', deviceError };
  }
  const result = await model(InferenceMode.ONLY_IN_CLOUD, lang, req.cloudJson ? {} : undefined).generateContent(req.cloudParts, options);
  const reported = result.response.inferenceSource;
  return { text: result.response.text(), source: reported === 'on_device' ? 'on_device' : 'in_cloud', deviceError };
}

export function imagePart(base64: string, mimeType: string): Part {
  return { type: 'inlineData', inlineData: { data: base64, mimeType } };
}
