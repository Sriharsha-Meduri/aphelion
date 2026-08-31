/**
 * All money is handled as integer paise (the smallest INR subunit), which is
 * also the unit Razorpay expects. Never use floats for currency math. The LLM
 * never performs any of these calculations; they are deterministic here.
 */

export type Paise = number;

export function assertPaise(value: number, label = 'amount'): Paise {
  if (!Number.isInteger(value)) throw new Error(`${label} must be integer paise, got ${value}`);
  if (value < 0) throw new Error(`${label} must be non-negative, got ${value}`);
  return value;
}

/** Round a probability-weighted paise value to the nearest whole paise. */
export function weightedPaise(amount: Paise, probability: number): Paise {
  const p = clamp01(probability);
  return Math.round(amount * p);
}

export function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

export function rupees(paise: Paise): number {
  return paise / 100;
}

/** Format paise as a readable INR string, e.g. 249900 -> "Rs 2,499.00". */
export function formatInr(paise: Paise): string {
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const whole = Math.floor(abs / 100);
  const frac = (abs % 100).toString().padStart(2, '0');
  const grouped = groupIndian(whole);
  return `${negative ? '-' : ''}Rs ${grouped}.${frac}`;
}

/** Indian digit grouping: 12,34,567 rather than 1,234,567. */
function groupIndian(n: number): string {
  const s = n.toString();
  if (s.length <= 3) return s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  return rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
}

export type ValueTier = 'low' | 'medium' | 'high' | 'premium';

/** Deterministic transaction value tiers, used by policy and features. */
export function valueTier(paise: Paise): ValueTier {
  if (paise < 50000) return 'low'; // under Rs 500
  if (paise < 300000) return 'medium'; // Rs 500 to 3,000
  if (paise < 2000000) return 'high'; // Rs 3,000 to 20,000
  return 'premium'; // Rs 20,000 and above
}
