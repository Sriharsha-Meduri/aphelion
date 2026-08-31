/**
 * A small, dependency-free logistic regression with feature standardization and
 * L2 regularization. Deterministic (zero init, full-batch gradient descent), so
 * training is exactly reproducible from the seeded dataset. Kept simple on
 * purpose: the value here is a calibrated probability, not model complexity.
 */

export interface Standardizer {
  mean: number[];
  std: number[];
}

export interface LogisticWeights {
  weights: number[];
  bias: number;
}

export function sigmoid(z: number): number {
  if (z >= 0) return 1 / (1 + Math.exp(-z));
  const e = Math.exp(z);
  return e / (1 + e);
}

export function fitStandardizer(X: number[][]): Standardizer {
  const n = X.length;
  const d = X[0]?.length ?? 0;
  const mean = new Array(d).fill(0);
  const std = new Array(d).fill(0);
  for (const row of X) for (let j = 0; j < d; j += 1) mean[j] += row[j];
  for (let j = 0; j < d; j += 1) mean[j] /= n || 1;
  for (const row of X) for (let j = 0; j < d; j += 1) std[j] += (row[j] - mean[j]) ** 2;
  for (let j = 0; j < d; j += 1) std[j] = Math.sqrt(std[j] / (n || 1)) || 1;
  return { mean, std };
}

export function standardize(s: Standardizer, x: number[]): number[] {
  return x.map((v, j) => (v - s.mean[j]) / (s.std[j] || 1));
}

export function rawLogit(w: LogisticWeights, xStd: number[]): number {
  let z = w.bias;
  for (let j = 0; j < xStd.length; j += 1) z += w.weights[j] * xStd[j];
  return z;
}

export interface FitOptions {
  epochs?: number;
  learningRate?: number;
  l2?: number;
}

export function fitLogistic(Xstd: number[][], y: number[], opts: FitOptions = {}): LogisticWeights {
  const epochs = opts.epochs ?? 400;
  const lr = opts.learningRate ?? 0.1;
  const l2 = opts.l2 ?? 1e-3;
  const n = Xstd.length;
  const d = Xstd[0]?.length ?? 0;
  const w: LogisticWeights = { weights: new Array(d).fill(0), bias: 0 };

  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const gradW = new Array(d).fill(0);
    let gradB = 0;
    for (let i = 0; i < n; i += 1) {
      const p = sigmoid(rawLogit(w, Xstd[i]));
      const err = p - y[i];
      for (let j = 0; j < d; j += 1) gradW[j] += err * Xstd[i][j];
      gradB += err;
    }
    for (let j = 0; j < d; j += 1) {
      gradW[j] = gradW[j] / n + l2 * w.weights[j];
      w.weights[j] -= lr * gradW[j];
    }
    w.bias -= lr * (gradB / n);
  }
  return w;
}
