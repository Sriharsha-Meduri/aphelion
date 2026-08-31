import type { CaseContext } from '../domain/context';
import type { MerchantPolicy } from '../domain/types';
import { assessRisk, type RiskAssessment } from '../diagnosis/signals';
import { scoreRecovery, type RecoveryScore } from './scorer';
import { computeEv, deriveDecision, type EvResult, type DeterministicDecision, type Economics } from './decision-engine';
import type { RecoveryModel } from './model';

/**
 * The deterministic assessment bundle: risk signals, calibrated probability,
 * expected value, and the bounded action set with a recommendation. This is the
 * shared core used both by the live pipeline and by the batch evaluation, so the
 * two never diverge.
 */
export interface RecoveryAssessment {
  risk: RiskAssessment;
  score: RecoveryScore;
  ev: EvResult;
  deterministic: DeterministicDecision;
}

export function assessCase(
  ctx: CaseContext,
  model: RecoveryModel | null,
  policy: MerchantPolicy,
  econ: Economics,
): RecoveryAssessment {
  const risk = assessRisk(ctx);
  const score = scoreRecovery(ctx, risk, model);
  const ev = computeEv(ctx, score, econ);
  const deterministic = deriveDecision(ctx, risk, ev, policy);
  return { risk, score, ev, deterministic };
}
