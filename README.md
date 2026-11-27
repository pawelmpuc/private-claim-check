# Private Claim Check

Check a car repair estimate from your insurer, compare it with a quote from your own workshop, and get a letter asking for the difference. The documents are read in your browser. Nothing leaves the device unless you switch the cloud on.

Built for the #BuildHybridAI hackathon with the Firebase AI Logic hybrid inference SDK. The interface is in English and Polish.

**Try it:** https://pawelmpuc.github.io/private-claim-check/ (Chrome on a desktop for the on-device model; any browser for the rest). There is also an [Android app](#android-app).

## Why on-device

A repair estimate carries a name, an address, a number plate, a VIN and a claim number. People are asked to upload such documents to web services all the time. Here a photo or a scan is read by Gemini Nano inside Chrome, and a digital PDF is read by plain code, so the document stays on the computer. The cloud model is a fallback that the user has to allow.

## What it does

1. **Reads the estimate.** A digital PDF is read from its own text, without a model, in about a second. A photo or a scan is transcribed by the on-device model and then sorted by code. Either way the result is a table of lines: parts, labour, paint, materials, other work and deductions.
2. **Explains it.** On request the on-device model says in plain words what the estimate allows and what the insurer took off. It gets only the lines, never the personal details.
3. **Lets you correct it.** Every line is editable. The audit never runs on text the user has not seen.
4. **Compares it with a workshop quote.** Optional, and the strongest case. A quote for the same repair is read the same way and set against the estimate category by category: parts, labour hours and rates, paint, materials, deductions, and the work the estimate leaves out altogether.
5. **Finds what is missing without a quote.** A rule engine in plain TypeScript compares the estimate with hourly rates the user enters and lists the shortfalls: labour rate, paint rate, depreciation and discounts, VAT. It also raises questions that have no amount: non-original parts, missing calibration, missing wheel alignment, totals that do not add up.
6. **Adapts to the country.** The country of the claim sets the currency and the default VAT rate; both stay editable.
7. **Writes the letter.** The letter is assembled from the audit result. The model may then change the tone of the opening and the closing paragraph: firmer, friendlier or shorter. The numbered points with the amounts never reach a model.

## How AI is used, and where it is not

| Step | Who does it | Why |
| --- | --- | --- |
| Reading a digital PDF | Code, from the PDF's text layer | The figures are already exact; a model could only add mistakes |
| Reading a photo or a scan | Model, on-device first | There is no text to read, and layouts differ between insurers |
| Sorting rows into parts, labour, paint and so on | Code | It must behave the same way every time |
| Explaining the estimate in plain words | Model, on-device first | Turning a table into sentences is language work |
| Calculating amounts | Code | Amounts must be reproducible and explainable |
| Drafting the letter | Code | Every figure comes from the audit |
| Changing the tone of the opening and closing | Model, on-device first | Optional |
| Filling in name, insurer, claim number | Code, locally | Personal details never go into a prompt |

The model never produces a figure the user relies on. Three checks hold that line:

- The model never calculates. It returns rows; `src/lib/audit.ts` and `src/lib/compare.ts` do the arithmetic.
- An explanation is shown only if every figure in it also appears in the estimate (`inventedFigure` in `src/lib/explain.ts`). Gemini Nano once wrote "US$0.00" next to each part; the check discarded that answer.
- Reworded paragraphs are accepted only if they came back as two clean paragraphs with the same figures in the same order and no blanks to fill in, and only if the opening still refuses the estimate and the closing still asks for payment (`applyPolish` in `src/lib/letter.ts`). On the test laptop Gemini Nano once turned "please pay within 14 days" into "please confirm your understanding"; that version is now rejected. Otherwise the plain version stays, and the app says what failed.

## Hybrid routing

All inference goes through Firebase AI Logic (`src/lib/ai.ts`). The app does not use `PREFER_ON_DEVICE`, because it needs to know where a request will run before it sends anything:

1. Ask Chrome whether the on-device model is available.
2. If it is, run with `InferenceMode.ONLY_ON_DEVICE` and the full document.
3. If it is not, or the device run fails, and the user has allowed the cloud, run with `InferenceMode.ONLY_IN_CLOUD`. Text is redacted first (`src/lib/redact.ts`): emails, phone numbers, VINs, plates, IBANs and 11-digit ID numbers. Photos cannot be redacted, and the interface says so.
4. If the cloud is not allowed, stop and say why.

A browser can report the on-device model as available and still fail to start it. The device attempt is therefore abandoned when no text arrives within 90 seconds, and the app then follows steps 3 and 4.

The panel at the top of the page logs each request with the place it ran, taken from `response.inferenceSource`. A PDF read from its text layer is logged as "no AI used".

### Other Firebase products

- **App Check** (reCAPTCHA Enterprise) protects the AI endpoint, so the key in the page cannot be used from elsewhere.
- **Remote Config** carries two settings: the name of the cloud model and the 90-second wait above. Model names get retired; this lets the app move to a new one without a release. The values are checked before use, and the app runs on built-in defaults when Remote Config does not answer.

### How a document is read

- **Digital PDF.** `pdf.js` returns the text with its position on the page. `src/lib/pdftext.ts` rebuilds the rows and the columns from those positions.
- **Estimates from estimating systems.** These run to several pages of operation lines with separate columns for parts, labour hours and paint hours. The app does not try to price every line. It reads the totals block at the end, where the document itself states parts, labour hours and rate, paint hours and rate, materials and deductions (`src/lib/summary.ts`), and keeps the operation lines as descriptions.
- **Photo or scan, on the device.** Gemini Nano copies a table well and restructures it badly, and it scales every image down to a small fixed size. So the app trims the white margins, cuts the page into wide overlapping tiles, and asks the model only to transcribe each tile row by row. The transcription is streamed to the page as it is written. Plain TypeScript then sorts the rows (`parseTranscription` in `src/lib/extract.ts`) and drops rows that two tiles share or that the model wrote twice.
- **Photo or scan, in the cloud.** The whole page goes to Gemini in one request, in JSON mode.

The printed total doubles as a checksum. Gemini Nano sometimes copies a printed "-1 593,00" as two cells, "-1" and "593,00". The parser keeps both readings and takes the one that makes the lines add up to the total; a line it cannot settle is highlighted. When the lines still do not add up to the printed total, the app says so above the table instead of carrying on.

A row is treated as a deduction only on evidence in the row itself: a negative amount or a word such as "rabat", "depreciation" or "betterment". A section heading alone is not enough, because a misread heading would otherwise add money to the claim.

## Android app

`android/` holds a native Android app (Kotlin, Android 8 and newer). It shows the same interface, packed into the APK, and gives it one door to a model: a small bridge (`AiBridge.kt`) to the **Firebase AI Logic Android SDK**. The routing rules above do not change. The page still decides where a request may run; the bridge calls the SDK with `InferenceMode.ONLY_ON_DEVICE` (Gemini Nano through AICore, on phones that have it) or `InferenceMode.ONLY_IN_CLOUD`, streams the answer back and reports `inferenceSource`. Consent, redaction and the figure checks are the same code as on the web.

App Check protects the AI endpoint on Android too. This build uses the App Check debug provider, which the hackathon rules accept; a store release would use Play Integrity. No APK is published in this repository: build it as shown below.

What has been checked on Android, and what has not:

| Where | What was checked | Result |
| --- | --- | --- |
| Pixel 10 Pro, Android 16, a real phone in Firebase Test Lab | Install, start, the status of the on-device model, one request to the cloud model through the SDK with App Check enforced | The cloud request answered in 2 seconds, `inferenceSource` said cloud, the figure check passed. On-device model: unavailable |
| Galaxy S26, Android 16, a real phone in Firebase Test Lab | Install, start, the status of the on-device model, asked again for 25 minutes | On-device model: unavailable |
| Android 16 emulator in Firebase Test Lab | The same as on the Pixel | The cloud request answered in 2 seconds, the figure check passed |
| On-device inference on a phone | | **Not confirmed yet** |

The on-device half could not be shown in Test Lab, and the logs say why. Its phones are wiped before every run and carry no Google account, so AICore, the service that provides Gemini Nano, is still the factory placeholder there (version `0.stub…`); the real one arrives through the Play Store. The Pixel in the lab also has an unlocked bootloader, which rules Gemini Nano out by itself. The on-device code follows the documented calls (`FirebaseAIOnDevice.checkStatus()`, `download()`, `InferenceMode.ONLY_ON_DEVICE`) and reports "unavailable" correctly on every phone above, but no phone with a working Gemini Nano has run it. On such a phone, the link **Check the on-device AI on this phone** in the privacy panel runs the self-test described below.

The self-test (`SelfTest.tsx`) runs by itself. It asks the SDK whether the phone has the on-device model, downloads it if it can, explains the built-in sample estimate on the device, runs the figure check on the answer and, when asked to, repeats the request against the cloud model. Every step is written on the screen and to logcat under the tag `PCC`. The app opens the self-test by itself in Firebase Test Lab; `android/labtest` is a helper APK for an Instrumentation run there, which also records the state of the phone (tag `PCCLAB`).

To build it:

```bash
npm run android:assets                      # builds the web app into the APK's assets
cd android
cp firebase.properties.example firebase.properties   # fill in from the Firebase console
gradle assembleDebug
```

Each installation of a debug build makes its own App Check debug token and shows it at the bottom of the privacy panel; register it in the Firebase console (App Check, Apps, Manage debug tokens). Or create a token in the console and put it in `firebase.properties`, and the build works on any phone.

## What it was tested on

| Document | How it was read | Result |
| --- | --- | --- |
| CCC ONE estimate, 6 pages, published with personal data removed | Text layer, totals block | Parts, labour hours and rates, paint and the total match the document |
| CCC ONE estimate, 8 pages, from a public US safety filing | Text layer, totals block | Same |
| Mitchell estimate, published sample | Text layer, totals block | Labour rows and totals match; the document names no currency, so the country setting supplies it |
| Audatex calculation (Poland) | Unit test only | The fixture was typed from a published image of the final calculation block. No real Audatex file has been run through the app |
| Fictional samples in `docs/samples` | Text layer, and Gemini Nano on the scanned quote | All categories and totals correct on the test laptop |

The real documents are not in this repository. The unit tests for the transcription parser use output Gemini Nano actually produced, misreadings included.

## Run it

Requirements: Node 20 or newer, a Firebase project with AI Logic enabled (Gemini Developer API) and App Check.

```bash
npm install
cp .env.example .env    # fill in the Firebase web app config and a reCAPTCHA site key
npm run dev
```

For local development set `VITE_APPCHECK_DEBUG=true`, open the console, and register the printed debug token under App Check in the Firebase console.

Remote Config is optional. To use it, add two parameters in the Firebase console: `cloud_model` (text) and `device_timeout_s` (number).

Without a `.env` file the app starts in demo mode: the sample estimate, the audit and the letter work, AI requests are disabled.

### On-device model

On-device inference needs a recent Chrome on a desktop that meets Chrome's hardware requirements for Gemini Nano. Open the app; the panel at the top says whether the model is ready. If it offers **Download the on-device model**, press it and wait; the first download takes several minutes. If the model is reported as ready and still does not answer, restart Chrome.

Older Chrome versions need `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` set to **Enabled**.

In other browsers the app works through the cloud path, once the user allows it. To see that path on a machine that has the on-device model, add `?nodevice` to the address.

## Tests

```bash
npm test
```

The tests cover the audit arithmetic, number parsing, the text-layer layout, the totals-block reader, the transcription parser, the pasted-text parser, the quote comparison, the explanation and letter checks, the Remote Config value check and redaction.

`docs/samples` holds fictional documents to try the app with:

- `sample-estimate-us.pdf` and `sample-quote-us.pdf`: an insurer estimate in the layout of a US estimating system and a workshop quote for the same repair (USD). `sample-quote-us-scan.jpg` is the same quote as a scan, for the on-device model.
- `sample-estimate-en.pdf` and `sample-quote-en.pdf`: a simple estimate and quote in GBP.
- `sample-estimate-pl.pdf`: an estimate in Polish (PLN).

## Limits

- The hourly rates shipped with the app are examples, not market data. The user is asked to replace them.
- The on-device model does not give the same answer twice. A scan that reads cleanly once may come back with a misread word the next time; the printed total catches the amounts it can, and the user is asked to check every line before the audit runs.
- On-device reading is slow. On a laptop with integrated graphics (Intel Iris Xe) a scanned page takes two to four minutes, an explanation about 50 seconds, and rewording the letter about 40 seconds. Up to six pages are read.
- An estimate read from its totals block gives category totals, not a price per operation. The checks that need single lines (non-original parts, for instance) then work from the descriptions only.
- Lines of the quote are matched to the estimate by the words of their descriptions. The amounts are compared by category and do not depend on that matching; the list of work the estimate leaves out does, and the interface asks the user to check it.
- The missing-operation checks are keyword heuristics. They raise questions; they do not put a price on anything.
- Redaction is pattern-based. It does not recognise names or street addresses.
- The Android app has run on Android 16 only. It needs a current Android System WebView; an early build showed a blank screen on a Pixel 5 with WebView 83, the build was changed for it, and that phone has not been tried again.
- This is information, not legal advice.

## Licence

Apache 2.0. See [LICENSE](LICENSE).
