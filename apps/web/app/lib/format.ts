// Money is paise (integer). Format to rupees without floating point drift.
export function inr(paise: number | null | undefined): string {
  if (paise == null) return 'Rs 0';
  const neg = paise < 0;
  const abs = Math.abs(Math.round(paise));
  const rupees = Math.floor(abs / 100);
  const paisePart = abs % 100;
  const grouped = groupIndian(rupees);
  const body = paisePart > 0 ? `${grouped}.${String(paisePart).padStart(2, '0')}` : grouped;
  return `${neg ? '-' : ''}Rs ${body}`;
}

// Compact for KPI headlines: Rs 1.2L, Rs 3.4Cr.
export function inrCompact(paise: number | null | undefined): string {
  if (paise == null) return 'Rs 0';
  const rupees = Math.round(paise / 100);
  if (rupees >= 10000000) return `Rs ${(rupees / 10000000).toFixed(2)} Cr`;
  if (rupees >= 100000) return `Rs ${(rupees / 100000).toFixed(2)} L`;
  if (rupees >= 1000) return `Rs ${(rupees / 1000).toFixed(1)}k`;
  return `Rs ${rupees}`;
}

function groupIndian(n: number): string {
  const s = String(n);
  if (s.length <= 3) return s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  return rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
}

export function pct(x: number | null | undefined, digits = 1): string {
  if (x == null || Number.isNaN(x)) return '-';
  return `${(x * 100).toFixed(digits)}%`;
}

export function when(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function timeOnly(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

type BadgeTone = 'gray' | 'blue' | 'green' | 'amber' | 'red' | 'violet';

const STATE_TONE: Record<string, BadgeTone> = {
  open: 'gray',
  assessed: 'gray',
  decided: 'blue',
  link_created: 'blue',
  attempted: 'blue',
  escalated: 'violet',
  stopped: 'red',
  no_action: 'gray',
  recovered: 'green',
};

export function stateTone(state: string): BadgeTone {
  return STATE_TONE[state] ?? 'gray';
}

export function prettyState(state: string): string {
  return state.replace(/_/g, ' ');
}

export function actionTone(action: string | null | undefined): BadgeTone {
  switch (action) {
    case 'SEND_PAYMENT_LINK': return 'blue';
    case 'RETRY_LATER': return 'amber';
    case 'ESCALATE': return 'violet';
    case 'STOP': return 'red';
    default: return 'gray';
  }
}
