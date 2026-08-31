// Thin client over the RecoverAI API. Requests go to same-origin /api and /demo,
// which next.config proxies to the API service.

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json() as Promise<T>;
}

async function send<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json() as Promise<T>;
}

export interface Stats {
  revenueAtRisk: number;
  revenueRecovered: number;
  recoveryRateByValue: number;
  recoveryRateByCount: number;
  totalCases: number;
  activeCases: number;
  successfulRecoveries: number;
  stoppedCases: number;
  escalatedCases: number;
  interventions: number;
  recoveryEfficiencyPaise: number;
  avgRecoveryMinutes: number;
  byState: Record<string, number>;
}

export interface CaseSummary {
  id: string;
  state: string;
  amountAtRisk: number;
  recoveredAmount: number;
  attempts: number;
  escalated: boolean;
  stopReason: string | null;
  openedAt: string;
  updatedAt: string;
  customerKey: string | null;
  method: string | null;
  failureCategory: string | null;
  providerPaymentId: string | null;
  latestAction: string | null;
  source: string | null;
  recoveryProbability: number | null;
  expectedValuePaise: number | null;
}

export interface Overview {
  merchant: { id: string; name: string };
  stats: Stats;
  recentCases: CaseSummary[];
}

export interface DecisionFactor {
  label: string;
  detail: string;
  weight: number;
  direction: 'supports' | 'opposes' | 'neutral';
}

export interface Decision {
  id: string;
  attempt: number;
  action: string;
  source: string;
  reason: string;
  confidence: number;
  recoveryProbability: number;
  expectedValuePaise: number;
  allowedActions: string[];
  factors: DecisionFactor[];
  policyApproved: boolean;
  policyBlockReason: string | null;
  modelVersion: string;
  createdAt: string;
}

export interface Intervention {
  id: string;
  type: string;
  status: string;
  attempt: number;
  shortUrl: string | null;
  referenceId: string | null;
  amount: number;
  providerObjectId: string | null;
  createdAt: string;
}

export interface AuditItem {
  id: string;
  event: string;
  actor: string;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

export interface CaseDetail {
  case: {
    id: string;
    state: string;
    amountAtRisk: number;
    recoveredAmount: number;
    attempts: number;
    escalated: boolean;
    stopReason: string | null;
    correlationId: string;
    openedAt: string;
    updatedAt: string;
    closedAt: string | null;
  };
  payment: {
    providerPaymentId: string;
    amount: number;
    method: string | null;
    state: string;
    failureCategory: string | null;
    errorReason: string | null;
    errorCode: string | null;
  } | null;
  customer: {
    customerKey: string;
    email: string | null;
    contact: string | null;
    optedOut: boolean;
    priorSuccesses: number;
    priorFailures: number;
    priorRecoveries: number;
  } | null;
  decisions: Decision[];
  interventions: Intervention[];
  audit: AuditItem[];
}

export interface Policy {
  merchantId?: string;
  maxAttempts: number;
  minValuePaise: number;
  maxAutonomousValuePaise: number;
  highValueEscalationPaise: number;
  cooldownMinutes: number;
  dailyActionBudget: number;
  stopOnSuspicious: boolean;
  minExpectedValuePaise: number;
}

export interface ModelInfo {
  version: string;
  trained: boolean;
  trainedAt?: string;
  seed?: number;
  metrics?: Record<string, number>;
  featureNames?: string[];
}

export const api = {
  overview: () => get<Overview>('/api/overview'),
  cases: (state?: string) => get<{ cases: CaseSummary[] }>(`/api/cases${state ? `?state=${state}` : ''}`),
  caseDetail: (id: string) => get<CaseDetail>(`/api/cases/${id}`),
  policy: () => get<{ policy: Policy }>('/api/policy'),
  savePolicy: (patch: Partial<Policy>) => send<{ policy: Policy }>('/api/policy', 'PUT', patch),
  override: (id: string, action: 'approve' | 'stop' | 'escalate') =>
    send<{ ok: boolean; state: string }>(`/api/cases/${id}/override`, 'POST', { action }),
  model: () => get<ModelInfo>('/api/model'),
  evaluation: () => get<Record<string, unknown>>('/api/evaluation'),
  seed: (count: number) => send<{ ok: boolean; seeded: number }>('/demo/seed', 'POST', { count }),
  scenario: (name: string) => send<{ ok: boolean; scenario: string; note: string }>(`/demo/scenario/${name}`, 'POST'),
};
