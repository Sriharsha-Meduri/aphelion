import { prettyState, stateTone } from '../lib/format';

export function Badge({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span className={`badge ${tone}`}>
      <span className="dot" />
      {children}
    </span>
  );
}

export function StateBadge({ state }: { state: string }) {
  return <Badge tone={stateTone(state)}>{prettyState(state)}</Badge>;
}

export function Kpi({ label, value, foot }: { label: string; value: React.ReactNode; foot?: React.ReactNode }) {
  return (
    <div className="card card-pad">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value num">{value}</div>
      {foot != null && <div className="kpi-foot">{foot}</div>}
    </div>
  );
}

export function Card({ title, action, children }: { title?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card">
      {(title || action) && (
        <div className="card-head">
          <span className="card-title">{title}</span>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return <div className="loading">{label}...</div>;
}

export function Empty({ label }: { label: string }) {
  return <div className="loading">{label}</div>;
}
