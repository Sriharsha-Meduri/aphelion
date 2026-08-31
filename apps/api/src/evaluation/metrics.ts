/**
 * Classification and calibration metrics for the recovery-probability model.
 * For a probability that feeds expected-value decisions, calibration (Brier,
 * ECE, reliability) matters as much as ranking (ROC-AUC, PR-AUC).
 */

export function rocAuc(scores: number[], labels: number[]): number {
  const idx = scores.map((s, i) => ({ s, y: labels[i] })).sort((a, b) => a.s - b.s);
  let rank = 1;
  let sumRanksPos = 0;
  let nPos = 0;
  let nNeg = 0;
  // Average ranks for ties.
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j < idx.length && idx[j].s === idx[i].s) j += 1;
    const avgRank = (rank + (rank + (j - i) - 1)) / 2;
    for (let k = i; k < j; k += 1) {
      if (idx[k].y === 1) {
        sumRanksPos += avgRank;
        nPos += 1;
      } else {
        nNeg += 1;
      }
    }
    rank += j - i;
    i = j;
  }
  if (nPos === 0 || nNeg === 0) return 0.5;
  return (sumRanksPos - (nPos * (nPos + 1)) / 2) / (nPos * nNeg);
}

export function prAuc(scores: number[], labels: number[]): number {
  const order = scores.map((s, i) => ({ s, y: labels[i] })).sort((a, b) => b.s - a.s);
  const totalPos = labels.reduce((a, y) => a + y, 0);
  if (totalPos === 0) return 0;
  let tp = 0;
  let fp = 0;
  let prevRecall = 0;
  let ap = 0;
  for (const o of order) {
    if (o.y === 1) tp += 1;
    else fp += 1;
    const precision = tp / (tp + fp);
    const recall = tp / totalPos;
    ap += precision * (recall - prevRecall);
    prevRecall = recall;
  }
  return ap;
}

export function brier(probs: number[], labels: number[]): number {
  return probs.reduce((a, p, i) => a + (p - labels[i]) ** 2, 0) / (probs.length || 1);
}

export function logLoss(probs: number[], labels: number[]): number {
  const eps = 1e-9;
  return (
    -probs.reduce((a, p, i) => {
      const q = Math.min(1 - eps, Math.max(eps, p));
      return a + (labels[i] === 1 ? Math.log(q) : Math.log(1 - q));
    }, 0) / (probs.length || 1)
  );
}

export interface ReliabilityBin {
  bin: number;
  avgPred: number;
  avgActual: number;
  count: number;
}

export function reliability(probs: number[], labels: number[], bins = 10): ReliabilityBin[] {
  const out: ReliabilityBin[] = [];
  for (let b = 0; b < bins; b += 1) {
    const lo = b / bins;
    const hi = (b + 1) / bins;
    let sumP = 0;
    let sumY = 0;
    let n = 0;
    for (let i = 0; i < probs.length; i += 1) {
      const p = probs[i];
      if ((p >= lo && p < hi) || (b === bins - 1 && p === 1)) {
        sumP += p;
        sumY += labels[i];
        n += 1;
      }
    }
    out.push({ bin: b, avgPred: n ? sumP / n : 0, avgActual: n ? sumY / n : 0, count: n });
  }
  return out;
}

export function ece(probs: number[], labels: number[], bins = 10): number {
  const rel = reliability(probs, labels, bins);
  const n = probs.length || 1;
  return rel.reduce((a, r) => a + (r.count / n) * Math.abs(r.avgPred - r.avgActual), 0);
}

export function baseRate(labels: number[]): number {
  return labels.reduce((a, y) => a + y, 0) / (labels.length || 1);
}
