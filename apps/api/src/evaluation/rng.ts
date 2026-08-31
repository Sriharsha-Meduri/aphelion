/**
 * Deterministic PRNG (mulberry32). Used everywhere synthetic data is generated
 * so that a given seed reproduces the exact same dataset, splits, and outcomes.
 * We never use Math.random in generation or evaluation.
 */
export class Rng {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  uniform(min = 0, max = 1): number {
    return min + (max - min) * this.next();
  }
  int(min: number, max: number): number {
    return Math.floor(this.uniform(min, max + 1));
  }
  bernoulli(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  /** Weighted pick. weights need not sum to 1. */
  weighted<T>(items: readonly { value: T; weight: number }[]): T {
    const total = items.reduce((a, x) => a + x.weight, 0);
    let r = this.next() * total;
    for (const it of items) {
      r -= it.weight;
      if (r <= 0) return it.value;
    }
    return items[items.length - 1].value;
  }
  /** Approx standard normal via sum of uniforms (Irwin-Hall), scaled. */
  normal(mean = 0, sd = 1): number {
    let s = 0;
    for (let i = 0; i < 6; i += 1) s += this.next();
    return mean + sd * ((s - 3) / Math.sqrt(0.5));
  }
}
