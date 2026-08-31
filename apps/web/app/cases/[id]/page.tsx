'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, type CaseDetail, type Decision } from '../../lib/api';
import { inr, pct, when, timeOnly, actionTone } from '../../lib/format';
import { Badge, Card, ErrorState, Loading, StateBadge } from '../../components/ui';

export default function CaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<CaseDetail | null>(null);
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.caseDetail(id));
    } catch {
      setErr(true);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const override = async (action: 'approve' | 'stop' | 'escalate') => {
    setBusy(true);
    try {
      await api.override(id, action);
      await load();
    } catch {
      /* surfaced by unchanged state */
    } finally {
      setBusy(false);
    }
  };

  if (err) return <ErrorState message="Cannot load this case. It may not exist, or the API is unreachable." />;
  if (!data) return <Loading label="Loading case" />;

  const c = data.case;
  const p = data.payment;
  const latest = data.decisions[data.decisions.length - 1];
  const closed = c.state === 'recovered' || c.state === 'stopped';

  return (
    <>
      <div className="page-head">
        <div>
          <div className="row gap-12" style={{ alignItems: 'center' }}>
            <Link href="/cases" className="muted" style={{ fontSize: 13 }}>Recovery queue</Link>
            <span className="muted">/</span>
            <span className="mono" style={{ fontSize: 13 }}>{c.id.slice(0, 12)}</span>
          </div>
          <h1 className="page-title mt-8">Case detail</h1>
        </div>
        <div className="btn-row">
          <button className="btn" disabled={busy || closed} onClick={() => override('approve')}>Approve link</button>
          <button className="btn" disabled={busy || c.escalated} onClick={() => override('escalate')}>Escalate</button>
          <button className="btn danger" disabled={busy || closed} onClick={() => override('stop')}>Stop</button>
        </div>
      </div>

      <div className="grid kpis">
        <div className="card card-pad">
          <div className="kpi-label">State</div>
          <div className="mt-8"><StateBadge state={c.state} /></div>
          {c.stopReason && <div className="kpi-foot">reason: {c.stopReason}</div>}
        </div>
        <div className="card card-pad">
          <div className="kpi-label">At risk</div>
          <div className="kpi-value num">{inr(c.amountAtRisk)}</div>
        </div>
        <div className="card card-pad">
          <div className="kpi-label">Recovered</div>
          <div className="kpi-value num" style={{ color: c.recoveredAmount > 0 ? 'var(--green)' : 'var(--text-3)' }}>{inr(c.recoveredAmount)}</div>
        </div>
        <div className="card card-pad">
          <div className="kpi-label">Attempts</div>
          <div className="kpi-value num">{c.attempts}</div>
          <div className="kpi-foot">{c.escalated ? 'escalated to human' : 'within autonomous bounds'}</div>
        </div>
      </div>

      <div className="grid split-even mt-16">
        <div className="stack gap-16">
          {latest && <DecisionCard d={latest} />}
          <Card title="Payment (deterministic facts)">
            <div className="card-pad">
              {p ? (
                <dl className="dl">
                  <dt>Payment id</dt><dd className="mono">{p.providerPaymentId}</dd>
                  <dt>Amount</dt><dd className="num">{inr(p.amount)}</dd>
                  <dt>Method</dt><dd>{p.method ?? '-'}</dd>
                  <dt>Payment state</dt><dd><span className="tag">{p.state}</span></dd>
                  <dt>Failure category</dt><dd>{p.failureCategory ?? '-'}</dd>
                  <dt>Error code</dt><dd className="mono">{p.errorCode ?? '-'}</dd>
                  <dt>Error reason</dt><dd>{p.errorReason ?? '-'}</dd>
                </dl>
              ) : (
                <span className="muted">No payment linked.</span>
              )}
            </div>
          </Card>
          {data.customer && (
            <Card title="Customer (redacted)">
              <div className="card-pad">
                <dl className="dl">
                  <dt>Customer key</dt><dd className="mono">{data.customer.customerKey}</dd>
                  <dt>Email</dt><dd className="mono">{data.customer.email ?? '-'}</dd>
                  <dt>Contact</dt><dd className="mono">{data.customer.contact ?? '-'}</dd>
                  <dt>Opted out</dt><dd>{data.customer.optedOut ? <Badge tone="red">yes</Badge> : <Badge tone="green">no</Badge>}</dd>
                  <dt>History</dt><dd>{data.customer.priorSuccesses} paid, {data.customer.priorFailures} failed, {data.customer.priorRecoveries} recovered</dd>
                </dl>
              </div>
            </Card>
          )}
        </div>

        <div className="stack gap-16">
          {data.interventions.length > 0 && (
            <Card title="Interventions">
              <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Type</th><th>Status</th><th>Amount</th><th>Reference</th></tr>
                </thead>
                <tbody>
                  {data.interventions.map((i) => (
                    <tr key={i.id}>
                      <td><span className="tag">{i.type}</span></td>
                      <td><Badge tone={i.status === 'created' ? 'blue' : 'gray'}>{i.status}</Badge></td>
                      <td className="num">{inr(i.amount)}</td>
                      <td className="mono" style={{ fontSize: 11 }}>{i.referenceId ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </Card>
          )}
          <Card title="Audit trail">
            <div className="card-pad">
              <div className="timeline">
                {data.audit.map((a) => (
                  <div key={a.id} className={`tl-item ${auditTone(a.event)}`}>
                    <div className="tl-event">{humanEvent(a.event)}</div>
                    <div className="tl-meta">{a.actor} - {timeOnly(a.createdAt)}</div>
                    {a.detail && Object.keys(a.detail).length > 0 && (
                      <div className="tl-detail">{JSON.stringify(a.detail)}</div>
                    )}
                  </div>
                ))}
                {data.audit.length === 0 && <span className="muted">No audit events.</span>}
              </div>
            </div>
          </Card>
        </div>
      </div>
      <div className="hint mt-16">Correlation id <span className="mono">{c.correlationId}</span> - opened {when(c.openedAt)}{c.closedAt ? `, closed ${when(c.closedAt)}` : ''}</div>
    </>
  );
}

function DecisionCard({ d }: { d: Decision }) {
  const maxW = Math.max(0.001, ...d.factors.map((f) => Math.abs(f.weight)));
  return (
    <Card title="Decision" action={<Badge tone={d.source === 'llm_agent' ? 'violet' : 'gray'}>{sourceLabel(d.source)}</Badge>}>
      <div className="card-pad">
        <div className="row between wrap gap-12">
          <Badge tone={actionTone(d.action)}>{d.action.replace(/_/g, ' ').toLowerCase()}</Badge>
          <div className="row gap-16">
            <Metric label="P(recover)" value={pct(d.recoveryProbability, 0)} />
            <Metric label="Expected value" value={inr(d.expectedValuePaise)} />
            <Metric label="Confidence" value={pct(d.confidence, 0)} />
          </div>
        </div>

        <div className="callout mt-16">{d.reason}</div>

        {d.factors.length > 0 && (
          <div className="mt-16">
            <div className="kpi-label" style={{ marginBottom: 10 }}>Decision factors</div>
            {d.factors.map((f, i) => (
              <div key={i} style={{ marginBottom: 10 }}>
                <div className="row between">
                  <span className="factor-name">{f.label}</span>
                  <span className="hint">{f.detail}</span>
                </div>
                <div className="factor-bar mt-8">
                  <div
                    className="factor-fill"
                    style={{
                      width: `${(Math.abs(f.weight) / maxW) * 100}%`,
                      background: f.direction === 'supports' ? 'var(--green)' : f.direction === 'opposes' ? 'var(--red)' : 'var(--border-strong)',
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="divider" />
        <div className="row between wrap gap-8">
          <span className="hint">Allowed action set (fixed before the model ran):</span>
          <div className="row gap-8 wrap">
            {d.allowedActions.map((a) => (
              <span key={a} className="tag">{a.replace(/_/g, ' ').toLowerCase()}</span>
            ))}
          </div>
        </div>
        <div className="row between mt-8">
          <span className="hint">Policy gate</span>
          {d.policyApproved ? <Badge tone="green">approved</Badge> : <Badge tone="red">blocked{d.policyBlockReason ? `: ${d.policyBlockReason}` : ''}</Badge>}
        </div>
      </div>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="stack" style={{ alignItems: 'flex-end' }}>
      <span className="hint">{label}</span>
      <span className="num" style={{ fontWeight: 650, fontSize: 15 }}>{value}</span>
    </div>
  );
}

function sourceLabel(source: string): string {
  if (source === 'llm_agent') return 'AI agent (bounded)';
  if (source === 'deterministic') return 'deterministic';
  if (source === 'fallback') return 'deterministic fallback';
  return source;
}

function humanEvent(event: string): string {
  return event.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

function auditTone(event: string): string {
  const e = event.toLowerCase();
  if (e.includes('recover') || e.includes('captured') || e.includes('paid')) return 'ok';
  if (e.includes('stop') || e.includes('block') || e.includes('fail') || e.includes('reject')) return 'stop';
  if (e.includes('escalat') || e.includes('override') || e.includes('fallback')) return 'warn';
  return '';
}
