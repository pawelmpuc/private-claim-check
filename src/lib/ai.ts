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

function model(mode: InferenceMode, outputLang = 'en', jsonSchema?: object) {
  return getGenerativeModel(getAi(), {
    mode,
    onDeviceParams: {
      createOptions: deviceIo(outputLang),
      promptOptions: jsonSchema ? { responseConstraint: jsonSchema } : undefined,
    },
    inCloudParams: {
      // Same model the SDK falls back to by default. JSON mode keeps the reply parseable.
      model: 'gemini-3.5-flash-lite',
      generationConfig: jsonSchema ? { responseMimeType: 'application/json', temperature: 0 } : { temperature: 0.3 },
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
  jsonSchema?: object;
  /** Language of the reply. Defaults to English. */
  outputLang?: string;
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
  if ((await deviceStatus(lang)) === 'available') {
    try {
      const result = await model(InferenceMode.ONLY_ON_DEVICE, lang, req.jsonSchema).generateContent(req.deviceParts);
      return { text: result.response.text(), source: 'on_device' };
    } catch (err) {
      deviceError = err instanceof Error ? err.message : String(err);
    }
  }
  if (!req.allowCloud) {
    throw new CloudNotAllowedError(deviceError ?? 'The on-device model is not available.');
  }
  const result = await model(InferenceMode.ONLY_IN_CLOUD, lang, req.jsonSchema).generateContent(req.cloudParts);
  const reported = result.response.inferenceSource;
  return { text: result.response.text(), source: reported === 'on_device' ? 'on_device' : 'in_cloud', deviceError };
}

export function imagePart(base64: string, mimeType: string): Part {
  return { type: 'inlineData', inlineData: { data: base64, mimeType } };
}
