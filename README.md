# RecoverAI

AI-assisted revenue recovery for failed payments, built for the Razorpay AI Buildathon (AI Revenue Recovery track).

RecoverAI turns a failed payment into a bounded recovery workflow: it detects revenue at risk, diagnoses the failure, scores the chance of recovery with a calibrated model, chooses one action from a fixed set through an AI reasoning step that can never exceed its bounds, executes it (a Razorpay Payment Link where appropriate), and attributes the recovered rupees when the customer pays. Every step is auditable, and the AI has no authority over money movement.

The one idea behind the whole system:

> AI decides within boundaries. Deterministic code enforces the boundaries.

## The problem

When a payment fails, the customer usually still wants to buy. That revenue is not lost, it is at risk. Recovering it well is a targeting problem: contacting every failed payment wastes money and goodwill, contacting none leaves revenue on the table, and contacting the wrong ones annoys good customers. It also has to be safe: no contacting opted-out customers, no acting on fraud-flagged payments, no unbounded autonomy over customer communication or money.

RecoverAI treats this as what it is: a bounded, measurable, auditable decision problem where AI helps with judgment but never holds the pen on money.

## The closed loop

```mermaid
flowchart TD
  A[payment.failed webhook] --> B[verify signature and dedupe by event id]
  B --> C[persist payment, open recovery case]
  C --> D[diagnose failure and assess risk signals]
  D --> E[calibrated recovery probability model]
  E --> F[expected value engine, bounded action set]
  F --> G[AI agent picks one allowed action and explains it]
  G --> H[deterministic policy gate]
  H -->|approved| I[create Razorpay Payment Link]
  H -->|blocked| J[stop or escalate, recorded]
  I --> K[customer pays, payment_link.paid webhook]
  K --> L[recovery attributed, rupees recovered]
  I --> M[audit trail updated at every step]
  J --> M
  L --> M
```

## Dashboard

An operations dashboard sits over the API: an overview of revenue at risk and recovered, the recovery queue, a full audit trail and decision explanation per case, the held-out evaluation, and the editable policy that bounds autonomy.

| Overview | Case detail (decision and audit trail) |
| --- | --- |
| ![Overview](docs/screenshots/overview.png) | ![Case detail](docs/screenshots/case-detail.png) |

| Held-out evaluation | Recovery queue |
| --- | --- |
| ![Evaluation](docs/screenshots/evaluation.png) | ![Recovery queue](docs/screenshots/queue.png) |

## Where AI is used, and where it is deliberately not

RecoverAI is intentionally layered so that facts and money stay deterministic and the LLM only reasons within a set of choices it did not create.

| Concern | How it is handled |
| --- | --- |
| Webhook signature, idempotency, payment state | Deterministic. HMAC-SHA256 over the raw body, unique event id, an explicit state machine. |
| Money math (amounts, expected value, recovered rupees) | Deterministic. Integer paise, no floats, never touched by the LLM. |
| Recovery probability | A calibrated logistic regression (ML), trained and evaluated on held-out data. |
| Which actions are allowed for a given case | Deterministic. Derived from the failure, the value, the customer, and the merchant policy. |
| Choosing one action and explaining it | The LLM, but only from the already-fixed allowed set, with a grounded explanation. |
| Executing the action | Deterministic. The action passes a policy gate before any Razorpay call. |
| Whether money was recovered | Deterministic. Only a confirmed successful payment counts. |

The path is always:

```
deterministic facts -> risk and policy -> AI reasoning (bounded) -> deterministic validation and gate -> action -> verification
```

It is never `LLM -> arbitrary API call -> money`.

## Safety: bounded autonomy

Every autonomous action passes a deterministic policy gate that is independent of the AI. Even if the model (through a bug, a bad response, or an injected instruction) proposes something unsafe, the gate refuses it:

- send on an already captured payment: blocked (already paid)
- contact an opted-out customer: blocked
- act on a fraud-flagged payment: blocked
- exceed the attempt limit or the daily action budget: blocked
- act inside the cooldown window: blocked
- high value transaction: escalated to a human, not sent autonomously

The AI can only ever narrow its own authority, never widen it. This is enforced by a boundary guard (the chosen action must be in the deterministically allowed set) and re-checked by the policy gate. See [SECURITY.md](SECURITY.md).

## Razorpay integration

RecoverAI implements the real Razorpay contracts and runs in two modes:

- `RAZORPAY_MODE=razorpay_test`: the real integration path. It verifies webhook signatures (`X-Razorpay-Signature`, HMAC-SHA256 over the raw body) and creates Payment Links via `POST /v1/payment_links/` with Basic auth. This is Razorpay Test Mode: no live customer money is involved.
- `RAZORPAY_MODE=mock` (default): a deterministic in-process double that creates the same Payment Link objects without any network call. Used for tests, evaluation, and the local demo.

The signature verification is real HMAC and is unit tested against the documented contract. The distinction between real Test Mode and local simulation is explicit in the code and here.

References used: [webhook validation](https://razorpay.com/docs/webhooks/validate-test/), [Payment Links create](https://razorpay.com/docs/api/payments/payment-links/create-standard/), [payment payloads](https://razorpay.com/docs/webhooks/payloads/payments/).

## Evaluation (held-out, honest)

Full detail and generation in [EVALUATION.md](EVALUATION.md) (generated by `npm run eval`). This is a Synthetic evaluation: it measures targeting and decision quality in a reproducible environment, not live money. Headline results on a held-out test split (customer-group split, seed 42):

- Recovery probability model: ROC-AUC about 0.72, PR-AUC about 0.58 against a base rate of about 0.34, calibration error (ECE) about 0.05.
- Targeting precision: the cases the model ranks in the top 10 percent by recovery probability convert at about 73 percent, roughly 1.9 times the base rate. The model finds the payers.
- Value: RecoverAI recovers essentially the same revenue as contacting every failed payment, using about a quarter fewer contacts, at a higher recovered-per-contact, while contact-everyone also contacts opted-out and fraud-flagged customers that RecoverAI excludes.
- Ablation: the calibrated model drives targeting quality over a rules baseline. The bounded LLM does not change the business numbers (an honest finding); its value is validity, safety, and explainability.
- Agent safety on the batch: 100 percent valid decisions, 0 policy violations, 100 percent rejection of an adversarial model that tried to act outside the allowed set, 100 percent fallback on malformed model output, injected instructions never changed the action.

## Failure handling

RecoverAI is built to fail safely. Covered and tested:

- duplicate webhook, and duplicate event id: processed once (unique event id, at-least-once idempotency)
- out-of-order events: a stale failure never downgrades a captured payment; a capture attributes recovery
- invalid or missing webhook signature: rejected with 401
- payment link creation failure: recorded, case left recoverable, no crash
- model unavailable, malformed model output, or an unsafe model action: deterministic fallback, safe action
- customer pays before or after the intervention: attributed correctly, never double counted
- LLM latency: the webhook acknowledges fast and the slow work runs in a background worker

The one real bug found during development and how it was fixed is written up in [ARCHITECTURE.md](ARCHITECTURE.md#a-real-failure-and-the-fix).

## Quick start

Requirements: Node 20 or newer. No database needed for the demo (in-memory mode).

```bash
npm install
npm run train        # train the recovery model from the seeded dataset
npm run eval         # generate held-out evaluation results (EVALUATION.md, evaluation.json)
DB_DRIVER=memory RAZORPAY_MODE=mock LLM_PROVIDER=mock npm run dev
```

Then, in another shell:

```bash
curl -s -X POST localhost:4000/demo/seed -H 'content-type: application/json' -d '{"count":40}'
curl -s localhost:4000/api/overview
```

Run the full test suite:

```bash
npm test
```

With Postgres and Docker (optional):

```bash
docker compose up -d db
DATABASE_URL=postgres://postgres:postgres@localhost:5432/recoverai DB_DRIVER=postgres npm run migrate -w @recoverai/api
DATABASE_URL=... DB_DRIVER=postgres npm run dev
```

## Running against real Razorpay Test Mode

1. Create test API keys in the Razorpay dashboard and a webhook with a secret.
2. Set the environment:

```bash
RAZORPAY_MODE=razorpay_test
RAZORPAY_KEY_ID=rzp_test_xxx
RAZORPAY_KEY_SECRET=xxx
RAZORPAY_WEBHOOK_SECRET=xxx
```

3. Point the Razorpay webhook at `POST https://<your-host>/webhooks/razorpay` and subscribe to `payment.failed`, `payment.captured`, and `payment_link.paid`.
4. Trigger a test failed payment. RecoverAI opens a case, decides, and creates a real test Payment Link. Never uses live credentials or real money.

## Configuration

See [.env.example](.env.example). Key variables: `DB_DRIVER`, `DATABASE_URL`, `RAZORPAY_MODE`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `LLM_PROVIDER` (`mock` or `gemini`), `GEMINI_API_KEY`, `INTERVENTION_COST_PAISE`. Secrets come from the environment only and are never logged.

## Tech stack

- API: Node.js, TypeScript, Fastify, PostgreSQL (with an in-memory adapter for tests and demo), Zod
- ML: a from-scratch calibrated logistic regression in TypeScript (no Python dependency), so training and evaluation run in the same reproducible toolchain
- LLM: provider abstraction with a deterministic mock (default) and Google Gemini via the official `@google/genai` SDK
- Testing: Vitest (unit, integration, security, HTTP end to end)
- Frontend: Next.js operations dashboard

## Repository layout

```
apps/api/src/
  config/        environment loading and validation
  domain/        entities, enums, payment and case state machines, decision context
  diagnosis/     failure classifier, modular risk-signal detectors
  recovery/      features, calibrated logistic model, scorer, expected-value engine
  policy/        merchant policy and the deterministic policy gate
  ai/            provider abstraction, prompt, schema, sanitizer, bounded agent, guard
  razorpay/      client (real and mock), webhook verify and parse
  pipeline/      the closed-loop orchestrator and audit trail
  http/          Fastify app, webhook, dashboard API, demo
  workers/       async processor
  evaluation/    dataset generator, metrics, training, baselines, held-out harness
apps/web/        Next.js dashboard
```

## Limitations

- The evaluation is synthetic. The relative comparisons (policy versus policy, component versus component) are meaningful; the absolute rates are not market numbers.
- The end-to-end loop against real Razorpay Test Mode payments has not been measured here (it needs live test credentials); the integration path is implemented and the signature and payload contracts are tested.
- The async worker is in-process. For horizontal scale it should move to a durable queue; the seam is isolated for exactly this.
- Single merchant tenancy in the demo; the data model supports multiple merchants.

## Future work

- Durable queue and a reconciliation sweep for stuck events
- Learned uplift model (treatment versus control) rather than a recovery-probability model
- Multi-step recovery sequences (retry, then link, then reminder) with per-step policy
- A/B holdout in production to measure real incremental recovery
