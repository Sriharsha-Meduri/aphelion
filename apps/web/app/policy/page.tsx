'use client';

import { useEffect, useState } from 'react';
import { api, type ModelInfo, type Policy } from '../lib/api';
import { Badge, Card, ErrorState, Loading } from '../components/ui';

export default function PolicyPage() {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [model, setModel] = useState<ModelInfo | null>(null);
  const [draft, setDraft] = useState<Policy | null>(null);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState(false);

  useEffect(() => {
    Promise.all([api.policy(), api.model()])
      .then(([p, m]) => {
        setPolicy(p.policy);
        setDraft(p.policy);
        setModel(m);
      })
      .catch(() => setErr(true));
  }, []);

  if (err) return <ErrorState message="Cannot reach the API. Start it with npm run dev and refresh." />;
  if (!policy || !draft) return <Loading label="Loading policy" />;

  const dirty = JSON.stringify(policy) !== JSON.stringify(draft);

  const save = async () => {
    const patch: Partial<Policy> = {
      maxAttempts: draft.maxAttempts,
      minValuePaise: draft.minValuePaise,
      maxAutonomousValuePaise: draft.maxAutonomousValuePaise,
      highValueEscalationPaise: draft.highValueEscalationPaise,
      cooldownMinutes: draft.cooldownMinutes,
      dailyActionBudget: draft.dailyActionBudget,
      stopOnSuspicious: draft.stopOnSuspicious,
      minExpectedValuePaise: draft.minExpectedValuePaise,
    };
    const r = await api.savePolicy(patch);
    setPolicy(r.policy);
    setDraft(r.policy);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Policy</h1>
          <p className="page-sub">The bounds of autonomy. The AI can never act outside these limits.</p>
        </div>
        <div className="row gap-12">
          {saved && <span className="hint" style={{ color: 'var(--green)' }}>Saved</span>}
          <button className="btn" disabled={!dirty} onClick={() => setDraft(policy)}>Reset</button>
          <button className="btn primary" disabled={!dirty} onClick={save}>Save policy</button>
        </div>
      </div>

      <div className="grid split-policy">
        <Card title="Autonomous limits">
          <div className="card-pad stack gap-16">
            <Rupees label="Minimum value to act" hint="Below this, not worth a contact." value={draft.minValuePaise} onChange={(v) => setDraft({ ...draft, minValuePaise: v })} />
            <Rupees label="Max autonomous value" hint="Above this, escalate rather than act automatically." value={draft.maxAutonomousValuePaise} onChange={(v) => setDraft({ ...draft, maxAutonomousValuePaise: v })} />
            <Rupees label="High value escalation" hint="Cases at or above this go to a human." value={draft.highValueEscalationPaise} onChange={(v) => setDraft({ ...draft, highValueEscalationPaise: v })} />
            <Rupees label="Minimum expected value" hint="Skip actions whose expected value is below this." value={draft.minExpectedValuePaise} onChange={(v) => setDraft({ ...draft, minExpectedValuePaise: v })} />
            <Num label="Max attempts per case" hint="Recovery contacts before giving up." value={draft.maxAttempts} onChange={(v) => setDraft({ ...draft, maxAttempts: v })} />
            <Num label="Cooldown (minutes)" hint="Minimum gap between contacts to one customer." value={draft.cooldownMinutes} onChange={(v) => setDraft({ ...draft, cooldownMinutes: v })} />
            <Num label="Daily action budget" hint="Cap on autonomous contacts per day." value={draft.dailyActionBudget} onChange={(v) => setDraft({ ...draft, dailyActionBudget: v })} />
            <div className="row between">
              <div><div style={{ fontWeight: 550 }}>Stop on suspicious</div><div className="hint">Never act on a fraud-flagged payment.</div></div>
              <button className={`btn sm ${draft.stopOnSuspicious ? 'primary' : ''}`} onClick={() => setDraft({ ...draft, stopOnSuspicious: !draft.stopOnSuspicious })}>
                {draft.stopOnSuspicious ? 'On' : 'Off'}
              </button>
            </div>
          </div>
        </Card>

        <div className="stack gap-16">
          <div className="callout">
            These limits are enforced by a deterministic policy gate that runs on every action, independent of the AI. The gate is the last line before any Razorpay call or customer contact.
          </div>
          <Card title="Recovery model">
            <div className="card-pad">
              {model?.trained ? (
                <dl className="dl">
                  <dt>Version</dt><dd className="mono">{model.version}</dd>
                  <dt>Status</dt><dd><Badge tone="green">trained</Badge></dd>
                  <dt>Seed</dt><dd className="num">{model.seed ?? '-'}</dd>
                  <dt>ROC-AUC</dt><dd className="num">{model.metrics?.rocAuc?.toFixed(3) ?? '-'}</dd>
                  <dt>ECE</dt><dd className="num">{model.metrics?.ece?.toFixed(3) ?? '-'}</dd>
                  <dt>Features</dt><dd className="num">{model.featureNames?.length ?? '-'}</dd>
                </dl>
              ) : (
                <div className="stack gap-8">
                  <Badge tone="amber">heuristic prior</Badge>
                  <span className="hint">No trained model loaded. Run npm run train to fit one; the scorer falls back to a calibrated heuristic until then.</span>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function Rupees({ label, hint, value, onChange }: { label: string; hint: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="row between gap-16">
      <div style={{ flex: 1 }}><div style={{ fontWeight: 550 }}>{label}</div><div className="hint">{hint}</div></div>
      <div className="row gap-8" style={{ width: 150 }}>
        <span className="muted">Rs</span>
        <input className="field" type="number" value={Math.round(value / 100)} onChange={(e) => onChange(Math.max(0, Math.round(Number(e.target.value) * 100)))} />
      </div>
    </div>
  );
}

function Num({ label, hint, value, onChange }: { label: string; hint: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="row between gap-16">
      <div style={{ flex: 1 }}><div style={{ fontWeight: 550 }}>{label}</div><div className="hint">{hint}</div></div>
      <input className="field" style={{ width: 150 }} type="number" value={value} onChange={(e) => onChange(Math.max(0, Math.round(Number(e.target.value))))} />
    </div>
  );
}
