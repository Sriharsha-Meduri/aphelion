'use client';

import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { inrCompact, pct } from '../lib/format';
import { Badge, Card, ErrorState, Loading } from '../components/ui';

interface Evaluation {
  status?: string;
  generatedAt?: string;
  dataset?: { seed: number; numCases: number; nTrain: number; nVal: number; nTest: number; split: string };
  model?: { version: string; baseRate: number; rocAuc: number; prAuc: number; brier: number; ece: number; reliability: { bin: number; avgPred: number; avgActual: number; count: number }[] };
  precision?: { baseRate: number; points: { topPct: number; k: number; conversionRate: number; lift: number }[] };
  policies?: PolicyRow[];
  budgeted?: { strategy: string; budgetPct: number; sends: number; recoveredValue: number; conversionRate: number }[];
  agent?: Record<string, number>;
}

interface PolicyRow {
  name: string;
  contacts: number;
  recoveredValue: number;
  cost: number;
  net: number;
  recoveredPerContact: number;
  recoveryRateValue: number;
}

export default function EvaluationPage() {
  const [ev, setEv] = useState<Evaluation | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    api.evaluation().then((r) => setEv(r as Evaluation)).catch(() => setErr(true));
  }, []);

  if (err) return <ErrorState message="Cannot reach the API. Start it with npm run dev and refresh." />;
  if (!ev) return <Loading label="Loading evaluation" />;
  if (ev.status === 'not_run' || !ev.model) {
    return (
      <>
        <Head />
        <div className="callout warn">Not yet measured. Run <span className="mono">npm run eval</span> to generate held-out results.</div>
      </>
    );
  }

  const m = ev.model;
  const strategies = ['random', 'by_amount', 'aphelion'];
  const budgets = [0.1, 0.25, 0.5];

  return (
    <>
      <Head dataset={ev.dataset} />
      <div className="stack gap-16">
      <Card title="Recovery probability model">
        <div className="card-pad">
          <div className="metric-grid">
            <Metric label="ROC-AUC" value={m.rocAuc.toFixed(3)} note="ranking quality" />
            <Metric label="PR-AUC" value={m.prAuc.toFixed(3)} note={`base rate ${m.baseRate.toFixed(3)}`} />
            <Metric label="Brier" value={m.brier.toFixed(3)} note="lower is better" />
            <Metric label="ECE" value={m.ece.toFixed(3)} note="calibration error" />
          </div>
          <div className="mt-24">
            <div className="kpi-label" style={{ marginBottom: 12 }}>Reliability (predicted vs actual by decile)</div>
            <div className="row gap-8" style={{ alignItems: 'flex-end', height: 140 }}>
              {m.reliability.filter((r) => r.count > 0).map((r) => (
                <div key={r.bin} className="stack" style={{ flex: 1, alignItems: 'center', gap: 4 }}>
                  <div className="row gap-8" style={{ alignItems: 'flex-end', height: 110, gap: 3 }}>
                    <div title={`predicted ${pct(r.avgPred)}`} style={{ width: 12, height: `${r.avgPred * 100}%`, background: 'var(--border-strong)', borderRadius: 3 }} />
                    <div title={`actual ${pct(r.avgActual)}`} style={{ width: 12, height: `${r.avgActual * 100}%`, background: 'var(--accent)', borderRadius: 3 }} />
                  </div>
                  <span className="hint" style={{ fontSize: 10 }}>{r.count}</span>
                </div>
              ))}
            </div>
            <div className="row gap-16 mt-8">
              <LegendDot color="var(--border-strong)" label="predicted" />
              <LegendDot color="var(--accent)" label="actual" />
              <span className="hint">bar height = recovery rate, number = cases in bin</span>
            </div>
          </div>
        </div>
      </Card>

      {ev.precision && (
        <Card title="Targeting precision (does the model find the payers)">
          <div className="table-wrap">
          <table>
            <thead><tr><th>Top slice by P(recover)</th><th>Cases</th><th>Conversion</th><th>Lift vs base rate</th></tr></thead>
            <tbody>
              {ev.precision.points.map((pt) => (
                <tr key={pt.topPct}>
                  <td>Top {pct(pt.topPct, 0)}</td>
                  <td className="num">{pt.k}</td>
                  <td className="num" style={{ fontWeight: 600 }}>{pct(pt.conversionRate)}</td>
                  <td><Badge tone={pt.lift >= 1.5 ? 'green' : 'gray'}>{pt.lift.toFixed(2)}x</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </Card>
      )}

      {ev.policies && (
        <Card title="Policy comparison (held-out test set)">
          <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Strategy</th><th>Contacts</th><th>Recovered</th><th>Cost</th><th>Recovery rate</th><th>Recovered / contact</th></tr>
            </thead>
            <tbody>
              {ev.policies.map((p) => (
                <tr key={p.name} style={p.name === 'aphelion' ? { background: 'var(--accent-weak)' } : undefined}>
                  <td style={{ fontWeight: p.name === 'aphelion' ? 650 : 500 }}>
                    {p.name === 'aphelion' ? 'Aphelion' : p.name.replace(/_/g, ' ')}
                  </td>
                  <td className="num">{p.contacts}</td>
                  <td className="num" style={{ fontWeight: 600 }}>{inrCompact(p.recoveredValue)}</td>
                  <td className="num muted">{inrCompact(p.cost)}</td>
                  <td className="num">{pct(p.recoveryRateValue)}</td>
                  <td className="num">{inrCompact(p.recoveredPerContact)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <div className="card-pad hint">
            Project Aphelion recovers essentially the same value as contacting everyone, with fewer contacts and a higher recovered-per-contact, while also excluding opted-out and fraud-flagged customers that contact-all does not.
          </div>
        </Card>
      )}

      {ev.budgeted && (
        <Card title="Budgeted targeting (recovered value at a fixed contact budget)">
          <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Contact budget</th>{strategies.map((s) => <th key={s}>{s === 'aphelion' ? 'Aphelion' : s.replace(/_/g, ' ')}</th>)}</tr>
            </thead>
            <tbody>
              {budgets.map((b) => (
                <tr key={b}>
                  <td>Top {pct(b, 0)}</td>
                  {strategies.map((s) => {
                    const row = ev.budgeted!.find((x) => x.strategy === s && x.budgetPct === b);
                    const best = Math.max(...strategies.map((ss) => ev.budgeted!.find((x) => x.strategy === ss && x.budgetPct === b)?.recoveredValue ?? 0));
                    const isBest = row && row.recoveredValue === best;
                    return (
                      <td key={s} className="num" style={{ fontWeight: isBest ? 650 : 400, color: isBest ? 'var(--green)' : undefined }}>
                        {row ? inrCompact(row.recoveredValue) : '-'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </Card>
      )}

      {ev.agent && (
        <Card title="Agent safety (bounded reasoning under adversarial input)">
          <div className="card-pad">
            <div className="metric-grid">
              <Metric label="Valid decisions" value={pct(ev.agent.validDecisionRate, 0)} note="schema-valid, in bounds" />
              <Metric label="Policy violations" value={pct(ev.agent.policyViolationRate, 0)} note="actions outside limits" />
              <Metric label="Unsafe action rejected" value={pct(ev.agent.unsafeActionRejectionRate, 0)} note="boundary guard" />
              <Metric label="Injection kept action" value={pct(ev.agent.injectionActionKeptRate, 0)} note="prompt injection ignored" />
            </div>
            <div className="hint mt-16">
              Agreement with the deterministic recommendation was {pct(ev.agent.agreementWithDeterministic ?? 0, 1)}. When the model was broken or hostile, the fallback rate to a safe deterministic action was {pct(ev.agent.brokenProviderFallbackRate ?? 0, 0)}.
            </div>
          </div>
        </Card>
      )}
      </div>
    </>
  );
}

function Head({ dataset }: { dataset?: Evaluation['dataset'] }) {
  return (
    <div className="page-head">
      <div>
        <div className="row gap-8">
          <h1 className="page-title">Evaluation</h1>
          <Badge tone="amber">Synthetic evaluation</Badge>
        </div>
        <p className="page-sub">
          {dataset
            ? `Held-out test set: ${dataset.nTest} cases, group split by customer, seed ${dataset.seed}. Reproducible with npm run eval.`
            : 'Held-out, reproducible. Run npm run eval.'}
        </p>
      </div>
    </div>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="metric">
      <div className="m-label">{label}</div>
      <div className="m-value">{value}</div>
      {note && <div className="m-note">{note}</div>}
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="row gap-8" style={{ fontSize: 12, color: 'var(--text-3)' }}>
      <span style={{ width: 10, height: 10, borderRadius: 2, background: color, display: 'inline-block' }} />
      {label}
    </span>
  );
}
