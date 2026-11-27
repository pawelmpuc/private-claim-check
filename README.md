# Private Claim Check

Check a car repair estimate from your insurer and get a letter asking for the difference. The estimate is read by an AI model that runs in your browser. Nothing leaves the device unless you switch the cloud on.

Built for the #BuildHybridAI hackathon with the Firebase AI Logic hybrid inference SDK. The interface is in English and Polish.

## Why on-device

A repair estimate carries a name, an address, a number plate, a VIN and a claim number. People are asked to upload such documents to web services all the time. Here the document is read by Gemini Nano inside Chrome, so it stays on the computer. The cloud model is a fallback that the user has to allow.

## What it does

1. **Reads the estimate.** A photo or a PDF becomes a table of lines: parts, labour, paint, materials and deductions. PDFs are rendered to images in the browser, so they can be read on-device too. Pasted text needs no model at all; plain code reads it.
2. **Lets you correct it.** Every line is editable. The audit never runs on text the user has not seen.
3. **Finds what is missing.** A rule engine written in plain TypeScript compares the estimate with hourly rates the user enters and lists the shortfalls: labour rate, paint rate, depreciation and discounts, VAT. It also raises questions that have no amount: non-original parts, missing calibration, missing wheel alignment, totals that do not add up.
4. **Adapts to the country.** The country of the claim sets the currency and the default VAT rate; both stay editable.
5. **Shows three totals.** Cautious, realistic and optimistic, one for each local rate the user entered.
6. **Writes the letter.** The letter is assembled from the audit result. The model may then improve the wording, and the app checks its output.

## How AI is used, and where it is not

| Step | Who does it | Why |
| --- | --- | --- |
| Reading a photo or PDF | Model (on-device first) | Layouts differ between insurers; this is what a multimodal model is good at |
| Reading pasted text | Code; a model only if the code finds no priced lines | Typed figures are exact already |
| Calculating amounts | Code | Amounts must be reproducible and explainable |
| Drafting the letter | Code | Every figure comes from the audit |
| Improving the wording | Model (on-device first) | Optional |
| Filling in name, insurer, claim number | Code, locally | Personal details never go into a prompt |

Two guards keep the model away from the numbers:

- The model never calculates. It returns lines; `src/lib/audit.ts` does the arithmetic.
- A rewritten letter is accepted only if it contains exactly the numbers and placeholders of the draft (`verifyRewrite` in `src/lib/letter.ts`). Otherwise it is discarded, the app names the figure that failed, and the plain draft is shown.

## Hybrid routing

All inference goes through Firebase AI Logic (`src/lib/ai.ts`). The app does not use `PREFER_ON_DEVICE`, because it needs to know where a request will run before it sends anything:

1. Ask Chrome whether the on-device model is available.
2. If it is, run with `InferenceMode.ONLY_ON_DEVICE` and the full document.
3. If it is not, or the device run fails, and the user has allowed the cloud, run with `InferenceMode.ONLY_IN_CLOUD`. Pasted text is redacted first (`src/lib/redact.ts`): emails, phone numbers, VINs, plates, IBANs and 11-digit ID numbers. Photos cannot be redacted, and the interface says so.
4. If the cloud is not allowed, stop and say why.

A browser can report the on-device model as available and still fail to start it. The device attempt is therefore abandoned when no text arrives within 90 seconds, and the app then follows steps 3 and 4.

The panel at the top of the page logs each request with the place it ran, taken from `response.inferenceSource`.

The two paths read a page differently.

- **Cloud.** The whole page goes to Gemini in one request, in JSON mode.
- **Device.** Gemini Nano copies a table well and restructures it badly, and it scales every image down to a small fixed size. So the app trims the white margins, cuts the page into wide overlapping tiles, and asks the model only to transcribe each tile row by row. The transcription is streamed to the page as it is written. Plain TypeScript then sorts the rows into parts, labour, paint, materials and deductions (`parseTranscription` in `src/lib/extract.ts`) and drops rows that two tiles share or that the model wrote twice. The unit tests for that parser use transcriptions Gemini Nano actually produced, misreadings included.

The printed total doubles as a checksum. Gemini Nano sometimes copies a printed "-1 593,00" as two cells, "-1" and "593,00". The parser keeps both readings and takes the one that makes the lines add up to the total; a line it cannot settle is highlighted for the user.

A row is treated as a deduction only on evidence in the row itself: a negative amount or a word such as "rabat" or "depreciation". A section heading alone is not enough, because a misread heading would otherwise add money to the claim.

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

On-device inference needs a recent Chrome on a desktop that meets Chrome's hardware requirements for Gemini Nano. Open the app; the panel at the top says whether the model is ready. If it offers **Download the on-device model**, press it and wait; the first download takes several minutes. If the model is reported as ready and still does not answer, restart Chrome.

Older Chrome versions need `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` set to **Enabled**.

In other browsers the app works through the cloud path, once the user allows it.

## Tests

```bash
npm test
```

The tests cover the audit arithmetic, number parsing, the transcription parser, the pasted-text parser, the letter guard and redaction.

`docs/samples` holds two fictional estimates to try the app with, one in English (GBP) and one in Polish (PLN).

## Limits

- The hourly rates shipped with the app are examples, not market data. The user is asked to replace them.
- The missing-operation checks are keyword heuristics. They raise questions; they do not put a price on anything.
- Redaction is pattern-based. It does not recognise names or street addresses.
- On-device reading is slow. On a laptop with integrated graphics (Intel Iris Xe) a one-page sample takes about 100 seconds, and rewriting the letter about two and a half minutes. Up to six pages are read.
- The on-device model misreads some words, especially with diacritics, and now and then an amount. The printed total catches the amounts it can; the user is asked to check every line before the audit runs.
- This is information, not legal advice.

## Licence

Apache 2.0. See [LICENSE](LICENSE).
