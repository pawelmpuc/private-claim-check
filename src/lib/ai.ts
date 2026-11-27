import { initializeApp, type FirebaseApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider, ReCaptchaV3Provider } from 'firebase/app-check';
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, type AI, type Part } from 'firebase/ai';
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

/** How long the on-device model may take to produce its first text before the app gives up on it. */
export const DEVICE_START_TIMEOUT_S = 90;

const env = import.meta.env;

export const firebaseConfigured = Boolean(env.VITE_FIREBASE_API_KEY && env.VITE_FIREBASE_PROJECT_ID && env.VITE_FIREBASE_APP_ID);

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
export async function deviceStatus(outputLang = 'en'): Promise<DeviceStatus> {
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
      // Same model the SDK falls back to by default. JSON mode keeps the reply parseable.
      model: 'gemini-3.5-flash-lite',
      generationConfig: cloudJsonSchema ? { responseMimeType: 'application/json', temperature: 0 } : { temperature: 0.3 },
    },
  });
}

/** Must be called from a click handler. Downloads the on-device model if Chrome has not done so yet. */
export async function downloadDeviceModel(onProgress: (fraction: number) => void): Promise<void> {
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
        reject(new DeviceTimeoutError(`No answer from the on-device model after ${DEVICE_START_TIMEOUT_S} seconds.`));
      }, DEVICE_START_TIMEOUT_S * 1000);
    });
    const stream = (async () => {
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
  const result = await model(InferenceMode.ONLY_IN_CLOUD, lang, req.cloudJson ? {} : undefined).generateContent(req.cloudParts, options);
  const reported = result.response.inferenceSource;
  return { text: result.response.text(), source: reported === 'on_device' ? 'on_device' : 'in_cloud', deviceError };
}

export function imagePart(base64: string, mimeType: string): Part {
  return { type: 'inlineData', inlineData: { data: base64, mimeType } };
}
