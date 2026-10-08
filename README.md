# MedAssist AI

An educational clinical decision-support sandbox. A person describes their symptoms, answers a
short set of AI-generated follow-up questions, optionally uploads laboratory reports, radiology
reports and images, and receives a structured, carefully hedged health-information summary with
possible explanations, an urgency level, and a list of questions to take to a healthcare
professional.

> **This is not a diagnostic device.** It does not examine anyone, order tests, prescribe, or
> replace professional medical care. Every output is AI-generated decision support from
> user-supplied information and must be independently verified. See
> [`/disclaimer`](app/(marketing)/disclaimer/page.tsx).

---

## Contents

1. [What it actually does](#1-what-it-actually-does)
2. [Architecture](#2-architecture)
3. [The safety layer](#3-the-safety-layer)
4. [Setup](#4-setup)
5. [Environment variables](#5-environment-variables)
6. [Scripts](#6-scripts)
7. [Testing](#7-testing)
8. [Deployment to Vercel](#8-deployment-to-vercel)
9. [Security model](#9-security-model)
10. [Known limitations](#10-known-limitations)
11. [Project structure](#11-project-structure)

---

## 1. What it actually does

**Does**

- Organises a person's own description into a structured intake (symptoms, duration, severity,
  risk factors, missing information).
- Generates 3–8 follow-up questions chosen because the answer would change the interpretation.
- Transcribes values from an uploaded PDF **exactly as printed**, and discards any finding whose
  value cannot be located in the source text.
- Describes an uploaded image **only** when the configured model genuinely supports vision, and
  always labels the result as an unverified visual observation.
- Produces 2–5 ranked possible explanations with what supports each one and what would confirm or
  exclude it.
- Assigns an urgency level from `ROUTINE` to `EMERGENCY`, using a deterministic rule engine that
  can override the model.
- Generates a printable / downloadable report, and an optional one-paragraph appointment brief.

**Does not**

- State or imply a diagnosis. The prompts forbid it, the schemas bound it, and a post-validation
  pass rewrites residual over-confident phrasing into hedged language.
- Prescribe, recommend, or dose any medication.
- Read medical images unless a vision model is configured, and never claims to have done so
  otherwise.
- Produce heatmaps, saliency overlays, or numeric confidence percentages. No such computer-vision
  model exists here, so none is simulated.
- Claim HIPAA, GDPR, or any other compliance. That is a property of a deployment, not of code.
- Pretend to be a doctor, or use "100% accurate", or "diagnoses diseases".

### End-to-end flow

```
Landing page
  → sign in (Firebase Auth; Google, email/password, or reset)
    → New assessment wizard
        1. Information      age, sex
        2. Symptoms         chips + free text + duration/severity
        3. Questions        3–8 AI-generated, all skippable
        4. Documents        drag-and-drop upload, or paste text for scans
        5. Analysis         staged, real-time progress
        6. Assessment       results, report, PDF, share
      → Dashboard · My assessments · Reports · Profile · Settings
```

---

## 2. Architecture

| Concern | Choice | Why |
| --- | --- | --- |
| Framework | Next.js 16 (App Router, Turbopack) | Server Components + Route Handlers in one deployable unit |
| Language | TypeScript, `strict` + `noUncheckedIndexedAccess` | The domain is full of untrusted input |
| Styling | Tailwind CSS v4, CSS-first `@theme` tokens | One token system for light/dark and glass surfaces |
| Components | Radix primitives, hand-written in shadcn style | Accessible behaviour without a build-time dependency chain |
| Animation | Framer Motion | Progress and micro-interactions |
| Auth | Firebase Authentication | Google, email/password, reset |
| Database | Cloud Firestore | Structured case/analysis documents |
| Files | Cloud Storage (private) | Never public URLs |
| AI | OpenRouter, server-side only | Free-tier friendly, single abstraction point |

There is **no** Python, no Express, no separate backend, no Docker. `npm run build` produces
something Vercel can serve directly.

### The AI pipeline

Six specialised stages, each with its own prompt module, its own Zod schema, and one model call at
most:

| Stage | Endpoint | Prompt | Model calls |
| --- | --- | --- | --- |
| Deterministic safety scan | `PUT /api/ai/intake` | — | 0 |
| Intake | `POST /api/ai/intake` | `prompts/intake.ts` | 1 |
| Questions | `POST /api/ai/questions` | `prompts/questions.ts` | 1 |
| Document transcription | `POST /api/ai/document-analysis` | `prompts/document.ts` | 1 per document |
| Image description | `POST /api/ai/image-analysis` | `prompts/imaging.ts` | 1 per image, only if a vision model is configured |
| Final assessment | `POST /api/ai/assessment` | `prompts/assessment.ts` | 1 |
| Report + brief | `POST /api/ai/report` | `prompts/report.ts` | 0 (deterministic) + 1 optional |

The report itself performs **no** model call: it renders the validated assessment deterministically,
so the printed report and the on-screen assessment can never disagree.

Cost control: the safety layer is free and runs first; the intake is reused by the questions stage
instead of being resent; document and image stages only run when there is something to analyse;
intermediate results are summarised rather than resent in full.

### Model configuration

Model ids are configuration, never hardcoded. `lib/ai/models.ts` reads:

```env
OPENROUTER_MODEL=auto
OPENROUTER_FALLBACK_MODEL=auto
```

`auto` is deliberate: it lets OpenRouter route to whichever free model is currently healthy, which
survives the free tier churning without a redeploy. Pin a specific id when you want one.

On failure the client walks a chain of models, classifies the HTTP status into a safe user-facing
message, and retries with jittered backoff. Provider error bodies are logged server-side and never
serialised to the browser.

---

## 3. The safety layer

`lib/medical/triage.ts` is a deterministic rule engine that runs **before** and **independently
of** any model. It can only ever *raise* urgency.

`lib/medical/reconcile-urgency.ts` then merges the two decisions:

```
final = max(deterministic floor, model proposal)
```

If the model proposed something less urgent than the rules, the results page says so explicitly:
which level the AI suggested, which level is displayed, and that the deterministic rules decided it.

Everything in the rule set is visible to the user: **Settings → Safety rules** lists every rule,
its rationale, its urgency, and the ruleset version, plus an explicit statement that the rules are
an illustrative baseline that has not been clinically validated.

Three design decisions in the engine are worth knowing about, because each one is a place where a
naive implementation is dangerous:

1. **Question text is not evidence.** The application asks "Do you have chest pain?" — that is a
   prompt, not something the person said. Matching rules against question text would fire red flags
   for symptoms nobody reported. Question text is excluded unless the answer is a clear
   affirmative, in which case the question *is* an assertion.
2. **Negation suppression is opt-in per rule.** Only rules a person is routinely asked about as a
   yes/no checkbox (`chest_pain`, `airway_compromise`, `stroke_features`, …) suppress on a
   preceding negation. Self-harm, overdose and seizure wording never do — silently dropping those
   would fail in the dangerous direction.
3. **Composite rules are never negation-suppressed.** Several encode an *absence* symptom ("not
   passed urine"), where a negation cue is part of the finding rather than a contradiction.

**Validation status, stated plainly:** the rule set and the numeric thresholds in `THRESHOLDS`
derive from publicly documented, widely used triage categories (airway, breathing, circulation,
neurological, anaphylaxis, obstetric, mental-health). They have **not** been validated against a
clinical dataset and are not a substitute for NEWS2, qSOFA, CTAS or a local emergency protocol.
A test asserts that no rule is marked `validated: true`, so that claim cannot be introduced by
accident. Real clinical deployment requires clinician sign-off on every rule and threshold.

---

## 4. Setup

### Prerequisites

- Node.js 20.9+ (developed on 24.x)
- npm 10+
- A Google account, for Firebase
- An OpenRouter account, for the AI key

### 4.1 Clone and install

```bash
git clone <your-repo-url>
cd medassist-ai
npm install
```

### 4.2 Create a Firebase project

1. Go to <https://console.firebase.google.com> → **Add project**.
2. **Build → Authentication → Get started**.
   - Enable **Email/Password**.
   - Enable **Google** (optional but recommended).
3. **Build → Firestore Database → Create database**.
   - Start in **production mode**. Security rules are deployed in 4.5.
4. **Build → Storage → Get started**.
   - Same location as Firestore.
5. **Project settings → General → Your apps → Web (`</>`)** → register an app.
   - Copy the six `firebaseConfig` values. These go into `.env.local`.

### 4.3 Get an OpenRouter key

1. Go to <https://openrouter.ai/keys> → **Create key**.
2. Copy it. This is a **server-only** secret. Never prefix it with `NEXT_PUBLIC_`.

### 4.4 Configure environment variables

```bash
cp .env.example .env.local
```

Fill in:

```env
# Firebase web config — Firebase console → Project settings → General
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=

# OpenRouter — https://openrouter.ai/keys
OPENROUTER_API_KEY=
OPENROUTER_MODEL=auto
OPENROUTER_FALLBACK_MODEL=auto

# App URL
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

`.env.local` is gitignored. See [`.env.example`](.env.example) for the annotated version, including
the optional Admin SDK variables and the vision-model ones. **No Admin credential is required to run
the app.**

### 4.5 Deploy the security rules

```bash
npm install -g firebase-tools
firebase login
firebase use --add          # select the project
firebase deploy --only firestore:rules,firestore:indexes,storage:rules
```

Rules can also be pasted into the console: **Firestore → Rules** and **Storage → Rules**. Both
files (`firestore.rules`, `storage.rules`) are heavily commented.

> The rules are the primary access-control boundary. Do not skip this step and do not relax it.

### 4.6 Firebase Admin credentials (not required)

**The app does not need Admin credentials.** All persistence runs through the Firebase web SDK in
the browser (`lib/firebase/repositories-client.ts`), with Firestore and Storage Security Rules as the
access boundary. A Firebase *web* config cannot authorise server-side writes, so Admin credentials
were removed rather than left as a prerequisite — the web config alone is a complete setup.

Admin variables are still read for one narrow purpose: verifying the session cookie in
`/api/auth/session`. With them the cookie lives 5 days instead of 1 hour; without them it falls back
to REST token verification. **Everything else is unchanged without them.**

If you want the longer session, generate a key (**Project settings → Service accounts → Generate new
private key**) and add either form:

```env
FIREBASE_SERVICE_ACCOUNT_JSON={"project_id":"...","client_email":"...","private_key":"..."}
```

or

```env
FIREBASE_ADMIN_PROJECT_ID=
FIREBASE_ADMIN_CLIENT_EMAIL=
FIREBASE_ADMIN_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

### 4.7 Run locally

```bash
npm run dev
```

Open <http://localhost:3000>. Check <http://localhost:3000/dashboard/settings> to confirm the
deployment capabilities panel reports AI and image analysis correctly.

---

## 5. Environment variables

| Variable | Where it comes from | Exposure |
| --- | --- | --- |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Firebase console → Project settings → General | Public |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | same | Public |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | same | Public |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | same | Public |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | same | Public |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | same | Public |
| `OPENROUTER_API_KEY` | <https://openrouter.ai/keys> | **Server only** |
| `OPENROUTER_MODEL` | Configuration. Default `auto` | Server only |
| `OPENROUTER_FALLBACK_MODEL` | Configuration. Default `auto` | Server only |
| `OPENROUTER_IMAGE_MODEL` | Optional vision model id | Server only |
| `OPENROUTER_TIMEOUT_MS` | Optional. Default `45000` | Server only |
| `OPENROUTER_MAX_TOKENS` | Optional. Default `2048` | Server only |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Firebase console → Service accounts | **Server only** |
| `FIREBASE_ADMIN_PROJECT_ID` / `_CLIENT_EMAIL` / `_PRIVATE_KEY` | same, split form | **Server only** |
| `FIREBASE_STORAGE_BUCKET` | Optional Admin bucket override | Server only |
| `NEXT_PUBLIC_APP_URL` | Deployment origin | Public |

**Required:** the seven `NEXT_PUBLIC_FIREBASE_*` values, `OPENROUTER_API_KEY`, and
`NEXT_PUBLIC_APP_URL`. Everything Firebase Admin is optional — it only lengthens the session cookie.

The `NEXT_PUBLIC_FIREBASE_*` values are designed to be public — they identify the project and
authorise the client SDK. Security comes from Authentication plus Security Rules, never from
hiding them. Everything else is server-only; `lib/ai/openrouter.ts` and `lib/firebase/admin.ts`
both `import "server-only"`, so an accidental client import fails the build rather than shipping a
credential.

---

## 6. Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint (flat config, Next core-web-vitals + TypeScript) |
| `npm run typecheck` | `tsc --noEmit`, strict |
| `npm test` | Unit tests. Hermetic: no network, no credentials, no AI tokens |
| `npm run test:watch` | Unit tests in watch mode |
| `npm run test:integration` | **Live** OpenRouter tests. Costs a few free-tier tokens per run |
| `npm run test:all` | Unit + integration |
| `npm run check` | lint → typecheck → test → build |

---

## 7. Testing

```bash
npm test              # unit only — hermetic, instant, free
npm run test:integration   # live OpenRouter calls — needs OPENROUTER_API_KEY
```

324 unit tests, no network access and no credentials required, so the suite is deterministic and
runs identically on a laptop and in CI. `npm test` is scoped to the `unit` project precisely so
that a plain test run can never spend AI tokens.

`npm run test:integration` runs the **live** suite against the real OpenRouter API: real prompts,
real model, real validation. It exercises all five model stages, verifies that transcribed values
are grounded in the source text, that a prompt injection in a document changes nothing, that no
medication or dosage appears in next steps, and that a genuine emergency cannot be downgraded. It
skips itself when `OPENROUTER_API_KEY` is absent.

| File | Covers |
| --- | --- |
| `tests/triage.test.ts` | 60 tests: every emergency red flag, urgent and monitor rules, negation handling, question-text exclusion, demographic modifiers, numeric thresholds, rule-set integrity, and that no rule is marked clinically validated |
| `tests/urgency.test.ts` | 23 tests: the safety layer is a floor; the model can raise but never lower urgency; red-flag union and de-duplication; end-to-end proof that a real emergency case cannot be downgraded |
| `tests/coerce.test.ts` | 37 tests: shape coercion for model output that is structurally wrong but semantically fine; conservative timeframe inference; refusing to invent a rationale or a provenance tag |
| `tests/schemas.test.ts` | 47 tests: every Zod schema, JSON extraction from fenced/prose output, the over-confidence hedging pass, request-boundary validation |
| `tests/upload-policy.test.ts` | 35 tests: MIME/extension/magic-number validation, disguised executables, quotas, filename sanitisation including bidi and traversal |
| `tests/access.test.ts` | 45 tests: protected paths, ownership (fail-closed), storage-path isolation, open-redirect prevention, IP masking, rate limiting |
| `tests/security.test.ts` | 55 tests: control-character and delimiter-tag stripping, prompt-injection framing, identifier redaction, PDF text normalisation, fallback questions, demo-data safety |
| `tests/report.test.ts` | 22 tests: every section the report must contain, factual sections restating user input rather than model output, urgency provenance, unconditional disclaimer and limitations |

The access-control and ownership tests run against pure functions rather than Firebase, so
ownership logic is verified without provisioning an emulator.

**Rules are not compiler-verified here.** The Firebase emulator requires JDK 21; this environment
has 17, so `firestore.rules` and `storage.rules` were reviewed statically but never deployed or
compiled. Run `firebase deploy --only firestore:rules,storage:rules` against your project before
relying on them.

---

## 8. Deployment to Vercel

1. Push the repository to GitHub.
2. Import it at <https://vercel.com/new>.
3. Add every variable from [§5](#5-environment-variables) in Project → Settings → Environment
   Variables. Mark the server-only ones appropriately.
4. `npm run build` runs automatically. There is nothing else to configure — no build command
   override, no server runtime, no Docker.
5. Deploy. Then, in the Firebase console, add the Vercel domain to **Authentication → Settings →
   Authorised domains**.
6. Optionally run the Firebase emulators locally against the dev server:

   ```bash
   firebase emulators:start
   ```

### Cost

Free tier by design. The safety layer is free and runs first; each assessment uses a small fixed
number of model calls on OpenRouter's free models; uploads are capped at 10 MB per file and 30 MB
per assessment, 12 files per assessment.

---

## 9. Security model

**Layers, outermost first**

1. **Firestore Security Rules** — the real boundary. They run inside Firebase and cannot be
   bypassed by a modified browser. `firestore.rules` scopes every document to its owner and rejects
   unknown keys. Analysis records are immutable once written; audit logs are append-only under the
   owner. A shared report is readable by anyone holding the link, and only that: the rules permit a
   single `get` when `shareEnabled` is true and `shareId` matches the document's own id.
2. **Storage Security Rules** — a client may create objects only inside `users/{own-uid}/…`, only for
   allowed content types, and only below the size cap. Overwrite is refused outright, because an
   update could otherwise change content type or size without re-running the create checks. Reads are
   owner-only.
3. **Server-side deterministic triage** — the one thing the rules cannot do. Because the browser
   writes its own analysis records, a tampered client could in principle edit the stored copy of its
   own result. It cannot lower the urgency: `/api/ai/assessment` and `/api/ai/report` both re-run the
   red-flag rules server-side from the submitted case snapshot and ignore any client-supplied
   urgency. Impact is therefore self-misleading at worst, and never another user's data.
4. **`proxy.ts`** (Next 16's successor to `middleware.ts`) — UX only. It performs a structural
   check on the session cookie to redirect signed-out visitors before a render. It is explicitly
   *not* the security boundary.
5. **Server-only modules** — `import "server-only"` on the OpenRouter client, the Admin SDK wrapper
   and the session module.

**API requests are not redirected.** The proxy passes `/api/**` straight through so Route Handlers
return `401` with a structured JSON body. Redirecting an XHR to the HTML login page would break the
client's error handling.

**Upload validation** is layered: declared MIME → extension agreement → magic number from the first
bytes → size and per-assessment quotas → filename sanitisation. Extensions alone are never trusted.
A `.pdf` containing a shell script is rejected on signature mismatch.

**Prompt injection.** Uploaded documents and user prose are treated as hostile input. Before
reaching a model they are stripped of control and zero-width characters, stripped of bidi overrides
used to disguise file extensions, stripped of literal delimiter tags, capped in length, and
identifier-redacted. They are then wrapped in a per-request nonce-tagged block whose preamble states
that the contents are data and never instructions. Detection of injection phrasing is *annotative* —
the patient's own words are never deleted, because corrupting what someone typed is its own harm.

**Output validation.** No model response is trusted. Each stage declares a Zod schema; on failure
one repair call is attempted, and if that also fails the request returns an error and **nothing is
rendered**. A post-validation pass rewrites residual over-confident phrasing ("you have X" →
"the information provided may be consistent with X"). Document findings are additionally grounded:
any transcribed value that cannot be located in the source text is discarded and the discard is
reported.

**Error handling.** Provider internals, stack traces and Firestore error text are logged
server-side and never returned. Every user-facing message is safe to display.

**Audit trail.** Every analysis stores model, prompt version, latency, token counts, whether the
fallback model or a repair was used, which input categories were present, which triage rules fired,
and whether urgency was escalated. Audit logs deliberately contain no clinical content and no raw
prompts. Client IPs are masked before storage.

**Response codes.** A request for another user's record returns `404`, not `403`, so the existence
of someone else's data is never confirmed.

---

## 10. Known limitations

Stated plainly, because a tool that hides these is worse than useless.

- **The safety rules are not clinically validated.** Illustrative baseline only.
- **Rate limiting is per-instance and therefore best-effort.** On serverless, instances are
  ephemeral. The interface is shaped so a durable store could be dropped in.
- **Text-based PDFs only.** There is no OCR. A scanned report is reported as unreadable, and the
  user is offered a paste-in box instead. OCR would mean shipping a large model and transcribing
  document images to a third party without the user seeing exactly what was read.
- **Image analysis depends entirely on configuration.** The default model is text-only, so the
  honest default is that image analysis is unavailable and the UI says so.
- **Firestore queries are paginated but not cursor-stabilised** against concurrent writes.
- **All persistence runs in the browser.** That is what makes the web config sufficient on its own,
  and it puts the security burden on the rules. The cost is that a user can write their own
  assessment and analysis records, and can edit a stored analysis after the fact. Nothing else is
  reachable, and urgency is still re-derived server-side, so the blast radius is a user misleading
  *themselves* about their own saved copy. If that trade is unacceptable, put the data layer back
  behind Admin credentials — the rules and the client repository are the only two files that change.
- **Account deletion is a client-side cascade** and is correct but not transactional; a failure
  mid-way leaves partial state. Firestore and Storage have no multi-document transaction spanning
  both products, so this cannot be made atomic.
- **Download URLs are no longer short-lived.** With server-minted signed URLs they were; with the
  client SDK the guarantee is exactly what the rules say, which is owner-only reads. A URL handed to
  someone else will not resolve for them, but it will keep working for the owner.
- **`npm audit` reports high-severity advisories** in `fast-glob`/`braces` via `eslint-config-next`
  and in `@grpc/grpc-js` via the Firebase client. Both are dev-time or unused-in-request-path
  transitive dependencies; the fixes available require breaking downgrades. Review before any
  production deployment rather than accepting this note.
- **Not for clinical use, in any configuration, as shipped.**

---

## 11. Project structure

```
medassist-ai/
+-- app/
|   +-- (marketing)/            # landing, FAQ, privacy, disclaimer
|   +-- dashboard/              # overview, assessments, reports, profile, settings
|   +-- assessment/new/         # the six-step wizard
|   +-- share/[id]/             # read-only share view, no session required
|   +-- login/ signup/ forgot-password/
|   +-- api/
|       +-- ai/                 # intake, questions, document-analysis,
|       |                       # image-analysis, assessment, report, capabilities
|       +-- auth/session/       # Firebase ID token <-> session cookie
|   +-- data/                   # barrel for the client data layer
+-- components/
|   +-- ui/                     # button, card, dialog, input, select-options, ...
|   +-- layout/                 # app shell, marketing chrome, theme toggle
|   +-- assessment/             # wizard, store, progress, the six steps
|   +-- medical/                # disclaimer, emergency banner, results view
|   +-- imaging/                # zoom / pan / rotate / fullscreen viewer
|   +-- uploads/                # drag-and-drop dropzone
|   +-- reports/                # report actions, jsPDF builder, share view
|   +-- dashboard/
|   +-- marketing/
+-- lib/
|   +-- ai/
|       +-- openrouter.ts       # the ONLY place model calls happen
|       +-- models.ts           # model registry, capability detection
|       +-- schemas.ts          # every Zod contract + the hedging pass
|       +-- stages.ts           # stage orchestration
|       +-- coerce.ts           # normalise structurally-wrong model output
|       +-- extract-json.ts     # pure, testable
|       +-- prompts/            # safety, intake, questions, document,
|       |                       # imaging, assessment, report
|   +-- medical/
|       +-- triage.ts           # deterministic red-flag engine
|       +-- reconcile-urgency.ts# safety floor <- model proposal
|       +-- urgency.ts          # presentation metadata
|       +-- extract-text-client.ts # PDF text layer, in the browser
|       +-- text-cleanup.ts     # pure, testable
|       +-- fallback-questions.ts
|       +-- empty-case.ts
|       +-- demo-data.ts        # synthetic scenarios only
|   +-- security/
|       +-- access.ts           # path + ownership primitives
|       +-- untrusted.ts        # sanitise, delimit, redact
|       +-- upload-policy.ts    # file validation
|       +-- rate-limit.ts
|   +-- firebase/
|       +-- client.ts           # browser SDK, lazy singleton
|       +-- admin.ts            # optional: session-cookie verification only
|       +-- repositories-client.ts # ALL reads and writes live here
|   +-- auth/                   # session.ts (server), client.ts (browser)
|   +-- api/                    # client.ts, route-helpers.ts, guarded-case.ts
|   +-- uploads/                # limits.ts
+-- types/                      # medical, assessment, ai, ai-primitives, firebase
+-- tests/                      # 324 unit + 10 live integration tests
+-- firestore.rules storage.rules    # the access boundary
+-- proxy.ts                    # Next 16 proxy (was middleware)
+-- .env.example  eslint.config.mjs  vitest.config.mts
```

---

## Licence

Built as an educational project. Not for clinical use.
