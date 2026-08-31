import type { Paise } from '../util/money';
import type {
  AuditEvent,
  CaseState,
  Customer,
  DecisionFactor,
  DecisionSource,
  ActionType,
  InterventionStatus,
  InterventionType,
  Merchant,
  MerchantPolicy,
  Payment,
  PaymentEvent,
  RecoveryCase,
  RecoveryDecision,
  RecoveryIntervention,
  StopReason,
  UpsertPaymentInput,
} from '../domain/types';

export interface MerchantRepo {
  getOrCreate(name: string): Promise<Merchant>;
  getById(id: string): Promise<Merchant | null>;
  list(): Promise<Merchant[]>;
}

export interface UpsertCustomerInput {
  merchantId: string;
  contactHash: string;
  customerKey: string;
  email: string | null;
  contact: string | null;
}

export interface CustomerRepo {
  upsertByContact(input: UpsertCustomerInput): Promise<{ customer: Customer; created: boolean }>;
  getById(id: string): Promise<Customer | null>;
  setOptOut(id: string, optedOut: boolean): Promise<void>;
  applyCounters(id: string, delta: { successes?: number; failures?: number; recoveries?: number }): Promise<void>;
}

export interface PaymentRepo {
  /** Insert or transition a payment. Rejects illegal transitions and never downgrades a captured payment. */
  upsert(input: UpsertPaymentInput): Promise<{ payment: Payment; created: boolean; transitioned: boolean }>;
  getById(id: string): Promise<Payment | null>;
  getByProviderId(providerPaymentId: string): Promise<Payment | null>;
}

export interface NewPaymentEvent {
  providerEventId: string;
  eventType: string;
  providerPaymentId: string | null;
  payload: Record<string, unknown>;
}

export interface PaymentEventRepo {
  claim(input: NewPaymentEvent): Promise<{ event: PaymentEvent; created: boolean }>;
  markProcessed(id: string, status: PaymentEvent['status'], errorText?: string | null): Promise<void>;
  findByProviderId(providerEventId: string): Promise<PaymentEvent | null>;
}

export interface NewCase {
  merchantId: string;
  customerId: string;
  paymentId: string;
  amountAtRisk: Paise;
  correlationId: string;
}

export interface CasePatch {
  state?: CaseState;
  attempts?: number;
  recoveredAmount?: Paise;
  stopReason?: StopReason | null;
  escalated?: boolean;
  closedAt?: Date | null;
}

export interface CaseFilter {
  merchantId?: string;
  state?: CaseState;
  limit?: number;
}

export interface CaseRepo {
  create(input: NewCase): Promise<RecoveryCase>;
  getById(id: string): Promise<RecoveryCase | null>;
  getByPaymentId(paymentId: string): Promise<RecoveryCase | null>;
  update(id: string, patch: CasePatch): Promise<RecoveryCase>;
  list(filter: CaseFilter): Promise<RecoveryCase[]>;
}

export interface NewDecision {
  caseId: string;
  attempt: number;
  source: DecisionSource;
  action: ActionType;
  reason: string;
  recoveryProbability: number;
  expectedValuePaise: Paise;
  confidence: number;
  factors: DecisionFactor[];
  allowedActions: ActionType[];
  policyApproved: boolean;
  policyBlockReason: string | null;
  modelVersion: string;
  policyVersion: string;
  promptVersion: string;
  schemaVersion: string;
}

export interface DecisionRepo {
  insert(input: NewDecision): Promise<RecoveryDecision>;
  listByCase(caseId: string): Promise<RecoveryDecision[]>;
}

export interface NewIntervention {
  caseId: string;
  decisionId: string;
  attempt: number;
  type: InterventionType;
  status: InterventionStatus;
  providerObjectId: string | null;
  shortUrl: string | null;
  referenceId: string | null;
  amount: Paise;
  expiresAt: Date | null;
}

export interface InterventionRepo {
  insert(input: NewIntervention): Promise<RecoveryIntervention>;
  updateStatus(id: string, status: InterventionStatus, resolvedAt?: Date | null): Promise<void>;
  getByCase(caseId: string): Promise<RecoveryIntervention[]>;
  findByReferenceId(referenceId: string): Promise<RecoveryIntervention | null>;
  findByProviderObjectId(providerObjectId: string): Promise<RecoveryIntervention | null>;
  countActionsSince(merchantId: string, since: Date): Promise<number>;
  lastAttemptAt(caseId: string): Promise<Date | null>;
}

export interface NewAudit {
  caseId: string | null;
  correlationId: string;
  event: string;
  actor: AuditEvent['actor'];
  detail: Record<string, unknown>;
}

export interface AuditRepo {
  insert(input: NewAudit): Promise<AuditEvent>;
  listByCase(caseId: string): Promise<AuditEvent[]>;
}

export interface PolicyRepo {
  getForMerchant(merchantId: string): Promise<MerchantPolicy | null>;
  upsert(policy: MerchantPolicy): Promise<MerchantPolicy>;
}

export interface Repositories {
  merchants: MerchantRepo;
  customers: CustomerRepo;
  payments: PaymentRepo;
  paymentEvents: PaymentEventRepo;
  cases: CaseRepo;
  decisions: DecisionRepo;
  interventions: InterventionRepo;
  audit: AuditRepo;
  policies: PolicyRepo;
  ping(): Promise<void>;
  close(): Promise<void>;
}
