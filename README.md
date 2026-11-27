# Private Claim Check

Check a car repair estimate from your insurer and get a letter asking for the difference. The estimate is read by an AI model that runs in your browser. Nothing leaves the device unless you switch the cloud on.

Built for the #BuildHybridAI hackathon with the Firebase AI Logic hybrid inference SDK. The interface is in English and Polish.

## Why on-device

A repair estimate carries a name, an address, a number plate, a VIN and a claim number. People are asked to upload such documents to web services all the time. Here the document is read by Gemini Nano inside Chrome, so it stays on the computer. The cloud model is a fallback that the user has to allow.

## What it does

1. **Reads the estimate.** A photo, a PDF or pasted text becomes a table of lines: parts, labour, paint, materials and deductions. PDFs are rendered to images in the browser, so they can be read on-device too.
2. **Lets you correct it.** Every line is editable. The audit never runs on text the user has not seen.
3. **Finds what is missing.** A rule engine written in plain TypeScript compares the estimate with hourly rates the user enters and lists the shortfalls: labour rate, paint rate, depreciation and discounts, VAT. It also raises questions that have no amount: non-original parts, missing calibration, missing wheel alignment, totals that do not add up.
4. **Shows three totals.** Cautious, realistic and optimistic, one for each local rate the user entered.
5. **Writes the letter.** The letter is assembled from the audit result. The model may then improve the wording, and the app checks its output.

## How AI is used, and where it is not

| Step | Who does it | Why |
| --- | --- | --- |
| Reading the document | Model (on-device first) | Layouts differ between insurers; this is what a multimodal model is good at |
| Calculating amounts | Code | Amounts must be reproducible and explainable |
| Drafting the letter | Code | Every figure comes from the audit |
| Improving the wording | Model (on-device first) | Optional |
| Filling in name, insurer, claim number | Code, locally | Personal details never go into a prompt |

Two guards keep the model away from the numbers:

- The model never calculates. It returns lines; `src/lib/audit.ts` does the arithmetic.
- A rewritten letter is accepted only if it contains exactly the numbers and placeholders of the draft (`verifyRewrite` in `src/lib/letter.ts`). Otherwise it is discarded and the plain draft is shown.

## Hybrid routing

All inference goes through Firebase AI Logic (`src/lib/ai.ts`). The app does not use `PREFER_ON_DEVICE`, because it needs to know where a request will run before it sends anything:

1. Ask Chrome whether the on-device model is available.
2. If it is, run with `InferenceMode.ONLY_ON_DEVICE` and the full document.
3. If it is not, or the device run fails, and the user has allowed the cloud, run with `InferenceMode.ONLY_IN_CLOUD`. Pasted text is redacted first (`src/lib/redact.ts`): emails, phone numbers, VINs, plates, IBANs and 11-digit ID numbers. Photos cannot be redacted, and the interface says so.
4. If the cloud is not allowed, stop and say why.

The panel at the top of the page logs each request with the place it ran, taken from `response.inferenceSource`.

Structured output is used on both paths: a JSON Schema as `responseConstraint` on the device, JSON mode in the cloud.

## Run it

Requirements: Node 20 or newer, a Firebase project with AI Logic enabled (Gemini Developer API) and App Check.

```bash
npm install
cp .env.example .env    # fill in the Firebase web app config and a reCAPTCHA site key
npm run dev
```

For local development set `VITE_APPCHECK_DEBUG=true`, open the console, and register the printed debug token under App Check in the Firebase console.

Without a `.env` file the app starts in demo mode: the sample estimate, the audit and the letter work, AI requests are disabled.

### On-device model

On-device inference needs Chrome on desktop, version 139 or newer:

1. Open `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` and set it to **Enabled**.
2. Restart Chrome.
3. Open the app and press **Download the on-device model**. The first download takes several minutes.

In other browsers the app works through the cloud path, once the user allows it.

## Tests

```bash
npm test
```

The tests cover the audit arithmetic, number parsing, the letter guard and redaction.

## Limits

- The hourly rates shipped with the app are examples, not market data. The user is asked to replace them.
- The missing-operation checks are keyword heuristics. They raise questions; they do not put a price on anything.
- Redaction is pattern-based. It does not recognise names or street addresses.
- On-device input is limited to about 9,000 tokens per request, so the app reads one page at a time, up to six pages.
- This is information, not legal advice.

## Licence

Apache 2.0. See [LICENSE](LICENSE).
