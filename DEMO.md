# Project Aphelion demo (5 minutes)

A deterministic walkthrough of the full revenue-recovery loop: a failed payment becomes a diagnosed, scored, bounded, audited recovery. Everything runs offline (mock Razorpay, mock LLM), so it works every time with no credentials.

## Setup (once)

Requirements: Node 20 or newer.

```bash
npm install
npm run train        # fit the recovery model (deterministic, seed 42)
```

Start the API and the dashboard in two shells:

```bash
DB_DRIVER=memory RAZORPAY_MODE=mock LLM_PROVIDER=mock npm run dev
```

```bash
npm run dev:web      # dashboard on http://localhost:4100
```

Open http://localhost:4100.

## The 5-minute script

### 0:00 - Seed a batch (failed payments arrive)

On the Overview page, click **Seed 40 cases**. This drives 40 synthetic failed payments through the real pipeline. The KPI row fills in: revenue at risk, revenue recovered, recovery rate, recovered per contact.

Talking point: each failed payment is revenue at risk, not revenue lost. The system decides which to act on.

### 0:45 - Revenue risk and the pipeline

Point at the KPIs and the Case pipeline panel: cases are spread across recovered, link created, escalated, stopped, and no action. Nothing was contacted blindly.

### 1:15 - Open one recovered case

Go to **Recovery queue**, filter to **recovered**, and open a case whose decision is `send payment link`. This is the core of the demo. On the case detail page, read top to bottom:

1. Payment (deterministic facts): the provider payment id, amount, method, failure category, error code. These are facts, never invented.
2. Decision: the action chosen, P(recover), expected value, and a plain-language reason. The source badge shows the bounded AI agent picked it.
3. Decision factors: the signals that drove the score (failure type, value tier, timing, history).
4. Allowed action set: the fixed set the AI had to choose from, computed before the model ran.
5. Policy gate: approved. The deterministic gate re-checked the choice.

### 2:30 - Recovery and the audit trail

Still on the case: the Interventions table shows the Razorpay Payment Link that was created, and the case reached `recovered` when the payment confirmed. The Audit trail on the right lists every step with a timestamp and actor (system, agent, policy), tied to one correlation id.

Talking point: the recovered rupees are attributed only from a confirmed payment, and only once.

### 3:15 - Evaluation (held-out, honest)

Open the **Evaluation** page (labelled Synthetic evaluation). Point at:

- Model quality: ROC-AUC about 0.70, calibration error about 0.05, with a reliability chart.
- Targeting precision: the top 10 percent by score convert far above the base rate. The model finds the payers.
- Policy comparison: Project Aphelion recovers essentially the same revenue as contacting everyone, with fewer and safer contacts.
- Agent safety: 100 percent valid decisions, 0 policy violations, unsafe actions rejected, injection ignored.

### 4:00 - A failure scenario, handled

Back on the Overview page, click one of the scenario buttons. Each is deterministic:

- **Out of order**: a capture arrives before a stale failure. The payment stays captured and no recovery contact is made.
- **Unsafe model**: the model returns an action outside the allowed set. The boundary guard rejects it and the safe deterministic action is used.
- **AI down**: the model is unavailable. The deterministic engine still produces a safe decision.

Open the affected case and show the audit trail recording the safe outcome.

### 4:45 - Close

One line: AI decides within boundaries, deterministic code enforces the boundaries. Every rupee recovered is measured and every decision is auditable.

## Terminal-only alternative

No dashboard needed:

```bash
npm run seed         # seed a batch and print a recovery summary
npm run demo         # run all five scenarios and print what each proves
```

## Notes

- The scenario outcomes are deterministic. The seeded batch uses a fresh random seed each run, so exact counts vary, but the shape (some recovered, some escalated, some stopped) is always the same.
- The held-out evaluation is fully reproducible: `npm run eval` regenerates the same numbers from seed 42.
- Nothing here touches live Razorpay or real money. The real Test Mode path is implemented; see the README for enabling it with test credentials.
