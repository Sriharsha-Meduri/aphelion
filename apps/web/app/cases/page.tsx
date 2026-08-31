'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, type CaseSummary } from '../lib/api';
import { inr, pct, when, actionTone } from '../lib/format';
import { Badge, Card, Loading, StateBadge } from '../components/ui';

const FILTERS = ['all', 'recovered', 'link_created', 'escalated', 'stopped', 'no_action'];

export default function CasesPage() {
  const [cases, setCases] = useState<CaseSummary[] | null>(null);
  const [filter, setFilter] = useState('all');
  const [err, setErr] = useState(false);

  useEffect(() => {
    setCases(null);
    api
      .cases(filter === 'all' ? undefined : filter)
      .then((r) => setCases(r.cases))
      .catch(() => setErr(true));
  }, [filter]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Recovery queue</h1>
          <p className="page-sub">Every failed payment and the decision made on it</p>
        </div>
        <div className="btn-row">
          {FILTERS.map((f) => (
            <button key={f} className={`btn sm ${filter === f ? 'primary' : ''}`} onClick={() => setFilter(f)}>
              {f.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
      </div>

      <Card>
        {err ? (
          <div className="loading">Cannot reach the API.</div>
        ) : !cases ? (
          <Loading label="Loading cases" />
        ) : cases.length === 0 ? (
          <div className="loading">No cases in this view.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Case</th>
                <th>Customer</th>
                <th>At risk</th>
                <th>Method</th>
                <th>Failure</th>
                <th>P(recover)</th>
                <th>Decision</th>
                <th>State</th>
                <th>Recovered</th>
                <th>Opened</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => (
                <tr key={c.id} className="row-link" onClick={() => (window.location.href = `/cases/${c.id}`)}>
                  <td className="mono" style={{ fontSize: 12 }}>
                    <Link href={`/cases/${c.id}`}>{c.id.slice(0, 8)}</Link>
                  </td>
                  <td className="mono" style={{ fontSize: 12 }}>{c.customerKey?.slice(0, 10) ?? '-'}</td>
                  <td className="num" style={{ fontWeight: 600 }}>{inr(c.amountAtRisk)}</td>
                  <td className="muted">{c.method ?? '-'}</td>
                  <td><span className="tag">{c.failureCategory ?? 'unknown'}</span></td>
                  <td className="num">{c.recoveryProbability != null ? pct(c.recoveryProbability, 0) : '-'}</td>
                  <td>{c.latestAction ? <Badge tone={actionTone(c.latestAction)}>{c.latestAction.replace(/_/g, ' ').toLowerCase()}</Badge> : <span className="muted">-</span>}</td>
                  <td><StateBadge state={c.state} /></td>
                  <td className="num" style={{ color: c.recoveredAmount > 0 ? 'var(--green)' : 'var(--text-3)', fontWeight: c.recoveredAmount > 0 ? 600 : 400 }}>
                    {c.recoveredAmount > 0 ? inr(c.recoveredAmount) : '-'}
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>{when(c.openedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
