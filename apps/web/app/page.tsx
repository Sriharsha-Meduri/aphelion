'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, type Overview } from './lib/api';
import { inrCompact, pct, prettyState, stateTone, when, actionTone } from './lib/format';
import { Badge, Card, Empty, Kpi, Loading, StateBadge } from './components/ui';

export default function OverviewPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.overview());
      setErr(null);
    } catch {
      setErr('Cannot reach the API. Start it with npm run dev and refresh.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (err) return <ApiDown message={err} />;
  if (!data) return <Loading label="Loading overview" />;

  const s = data.stats;
  const states = Object.entries(s.byState).sort((a, b) => b[1] - a[1]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Overview</h1>
          <p className="page-sub">{data.merchant.name} - recovery across all failed payments</p>
        </div>
        <DemoControls onDone={load} />
      </div>

      <div className="grid kpis">
        <Kpi label="Revenue at risk" value={inrCompact(s.revenueAtRisk)} foot={`${s.totalCases} cases opened`} />
        <Kpi label="Revenue recovered" value={inrCompact(s.revenueRecovered)} foot={`${pct(s.recoveryRateByValue)} of value at risk`} />
        <Kpi label="Recovery rate" value={pct(s.recoveryRateByCount)} foot={`${s.successfulRecoveries} of ${s.totalCases} cases`} />
        <Kpi label="Recovered per contact" value={inrCompact(s.recoveryEfficiencyPaise)} foot={`${s.interventions} contacts made`} />
      </div>

      <div className="grid split-main mt-16">
        <Card title="Recent cases" action={<Link className="btn sm" href="/cases">View all</Link>}>
          {data.recentCases.length === 0 ? (
            <Empty title="No cases yet" hint="Seed a batch with the button above to watch the recovery loop run." />
          ) : (
            <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Case</th>
                  <th>At risk</th>
                  <th>Failure</th>
                  <th>Decision</th>
                  <th>State</th>
                  <th>Opened</th>
                </tr>
              </thead>
              <tbody>
                {data.recentCases.map((c) => (
                  <CaseRow key={c.id} c={c} />
                ))}
              </tbody>
            </table>
            </div>
          )}
        </Card>

        <div className="stack gap-16">
          <Card title="Case pipeline">
            <div className="card-pad stack gap-12">
              {states.length === 0 && <span className="muted">No activity yet.</span>}
              {states.map(([state, count]) => (
                <div key={state} className="stack" style={{ gap: 6 }}>
                  <div className="row between">
                    <Badge tone={stateTone(state)}>{prettyState(state)}</Badge>
                    <span className="num" style={{ fontWeight: 600 }}>{count}</span>
                  </div>
                  <div className="bar-track">
                    <div className="fill" style={{ width: `${(count / s.totalCases) * 100}%`, background: `var(--${barColor(state)})` }} />
                  </div>
                </div>
              ))}
            </div>
          </Card>
          <div className="callout">
            Every case above passed through the same closed loop: diagnose, score, choose a bounded action, gate it, and attribute recovery only on a confirmed payment.
          </div>
        </div>
      </div>
    </>
  );
}

function CaseRow({ c }: { c: Overview['recentCases'][number] }) {
  return (
    <tr className="row-link" onClick={() => (window.location.href = `/cases/${c.id}`)}>
      <td className="mono" style={{ fontSize: 12 }}>{c.id.slice(0, 8)}</td>
      <td className="num" style={{ fontWeight: 600 }}>{inrCompact(c.amountAtRisk)}</td>
      <td><span className="tag">{c.failureCategory ?? 'unknown'}</span></td>
      <td>{c.latestAction ? <Badge tone={actionTone(c.latestAction)}>{c.latestAction.replace(/_/g, ' ').toLowerCase()}</Badge> : <span className="muted">-</span>}</td>
      <td><StateBadge state={c.state} /></td>
      <td className="muted" style={{ fontSize: 12 }}>{when(c.openedAt)}</td>
    </tr>
  );
}

function barColor(state: string): string {
  const tone = stateTone(state);
  return tone === 'gray' ? 'border-strong' : tone;
}

function DemoControls({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setNote(null);
    try {
      await fn();
      onDone();
    } catch {
      setNote('Action failed. Is the API running?');
    } finally {
      setBusy(null);
    }
  };

  const scenario = async (name: string) => {
    setBusy(name);
    setNote(null);
    try {
      const r = await api.scenario(name);
      setNote(r.note);
      onDone();
    } catch {
      setNote('Scenario failed. Is the API running?');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="stack gap-8" style={{ alignItems: 'flex-end' }}>
      <div className="btn-row">
        <button className="btn primary" disabled={!!busy} onClick={() => run('seed', () => api.seed(40))}>
          {busy === 'seed' ? 'Seeding...' : 'Seed 40 cases'}
        </button>
        <button className="btn" disabled={!!busy} onClick={() => scenario('high_value')}>High value</button>
        <button className="btn" disabled={!!busy} onClick={() => scenario('out_of_order')}>Out of order</button>
        <button className="btn" disabled={!!busy} onClick={() => scenario('ai_down')}>AI down</button>
        <button className="btn" disabled={!!busy} onClick={() => scenario('unsafe')}>Unsafe model</button>
      </div>
      {note && <div className="hint" style={{ maxWidth: 460, textAlign: 'right' }}>{note}</div>}
    </div>
  );
}

function ApiDown({ message }: { message: string }) {
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Overview</h1>
          <p className="page-sub">Project Aphelion operations</p>
        </div>
      </div>
      <div className="callout warn" style={{ maxWidth: 620 }}>
        <strong>API not reachable.</strong>
        <div className="mt-8 mono" style={{ fontSize: 12 }}>DB_DRIVER=memory RAZORPAY_MODE=mock LLM_PROVIDER=mock npm run dev</div>
        <div className="hint mt-8">{message}</div>
      </div>
    </>
  );
}
