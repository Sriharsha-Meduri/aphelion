import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CaseContext } from '../domain/context';
import { extractFeatures } from './features';
import { standardize, rawLogit, type Standardizer, type LogisticWeights } from './logistic';
import { applyCalibration, type Calibration } from './calibration';
import { clamp01 } from '../util/money';

/**
 * A serialized recovery-probability model. Everything needed to reproduce a
 * prediction is captured, including the version stamp recorded on every
 * decision for auditability.
 */
export interface RecoveryModel {
  version: string;
  trainedAt: string;
  seed: number;
  featureNames: string[];
  standardizer: Standardizer;
  logistic: LogisticWeights;
  calibration: Calibration;
  metrics?: Record<string, number>;
}

export function predictWithModel(model: RecoveryModel, ctx: CaseContext): number {
  const x = extractFeatures(ctx);
  const xs = standardize(model.standardizer, x);
  const logit = rawLogit(model.logistic, xs);
  return clamp01(applyCalibration(model.calibration, logit));
}

export function loadModel(path: string): RecoveryModel | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as RecoveryModel;
  } catch {
    return null;
  }
}

export function saveModel(path: string, model: RecoveryModel): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(model, null, 2));
}
