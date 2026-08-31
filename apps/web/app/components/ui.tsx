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
  return (
    <div className="state-block">
      <div className="spinner" />
      <div className="state-hint">{label}...</div>
    </div>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="state-block">
      <svg className="state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 9h18M8 14h8" />
      </svg>
      <div className="state-title">{title}</div>
      {hint && <div className="state-hint">{hint}</div>}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="state-block">
      <svg className="state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--red)' }}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v4M12 16h.01" />
      </svg>
      <div className="state-title">Something went wrong</div>
      <div className="state-hint">{message}</div>
    </div>
  );
}
