import { sigmoid } from './logistic';

/**
 * Platt scaling: the raw model logit is mapped to a calibrated probability via
 * p = sigmoid(a * logit + b), with (a, b) fit on the VALIDATION split only.
 * A probability that feeds an expected-value decision must be well calibrated,
 * so we fit and report this separately from the classifier.
 */
export interface Calibration {
  a: number;
  b: number;
}

export function identityCalibration(): Calibration {
  return { a: 1, b: 0 };
}

export function applyCalibration(cal: Calibration, logit: number): number {
  return sigmoid(cal.a * logit + cal.b);
}

export function fitPlatt(logits: number[], y: number[], opts: { epochs?: number; learningRate?: number } = {}): Calibration {
  const epochs = opts.epochs ?? 1000;
  const lr = opts.learningRate ?? 0.05;
  const n = logits.length;
  let a = 1;
  let b = 0;
  for (let e = 0; e < epochs; e += 1) {
    let ga = 0;
    let gb = 0;
    for (let i = 0; i < n; i += 1) {
      const p = sigmoid(a * logits[i] + b);
      const err = p - y[i];
      ga += err * logits[i];
      gb += err;
    }
    a -= lr * (ga / (n || 1));
    b -= lr * (gb / (n || 1));
  }
  return { a, b };
}
