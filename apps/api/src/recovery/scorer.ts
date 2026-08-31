import type { CaseContext } from '../domain/context';
import type { RiskAssessment } from '../diagnosis/signals';
import { clamp01 } from '../util/money';
import { predictWithModel, type RecoveryModel } from './model';

export interface RecoveryScore {
  probability: number;
  source: 'model' | 'heuristic';
  modelVersion: string;
}

/**
 * Calibrated recovery probability. When a trained model is available it is used;
 * otherwise the system degrades to the heuristic prior from the risk assessment,
 * so scoring never hard-fails just because a model file is missing.
 */
export function scoreRecovery(ctx: CaseContext, risk: RiskAssessment, model: RecoveryModel | null): RecoveryScore {
  if (model) {
    return { probability: clamp01(predictWithModel(model, ctx)), source: 'model', modelVersion: model.version };
  }
  return { probability: clamp01(risk.recoverabilityPrior), source: 'heuristic', modelVersion: 'heuristic-prior-v1' };
}
