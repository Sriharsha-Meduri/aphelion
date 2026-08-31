/**
 * Untrusted text handling. Payment descriptions, customer notes, and merchant
 * free text are data, never instructions. The real defence is architectural
 * (this text is placed inside a delimited data block, and the action set is
 * fixed deterministically before the model runs), but we still strip control
 * characters and flag instruction-like content for observability and tests.
 */

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(the\s+)?(previous|above|prior|earlier)\s+(instructions|rules|prompt)/i,
  /disregard\s+(the\s+)?(policy|rules|instructions|system)/i,
  /\b(system|assistant|developer)\s*:/i,
  /you\s+are\s+now\b/i,
  /\bact\s+as\b/i,
  /\boverride\b.*\b(policy|limit|rule|attempt)/i,
  /\bnew\s+(instructions|system\s+prompt|rules)\b/i,
  /send\s+(a\s+)?\d{1,3}\s*%\s*(discount|off)/i,
  /\bsudo\b/i,
  /forget\s+(everything|all|previous)/i,
];

// Control characters (excluding tab and newline) and zero-width characters,
// built from ASCII escape strings so the source stays plain text. Stripping
// control characters is the intended behaviour here.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]', 'g');
const ZERO_WIDTH = new RegExp('[\\u200B-\\u200D\\uFEFF]', 'g');

export interface SanitizeResult {
  clean: string;
  injectionDetected: boolean;
  matched: string[];
}

export function sanitizeUntrusted(text: string | null | undefined, maxLen = 500): SanitizeResult {
  if (!text) return { clean: '', injectionDetected: false, matched: [] };

  let clean = String(text).replace(CONTROL_CHARS, ' ').replace(ZERO_WIDTH, '').replace(/\s+/g, ' ').trim();
  if (clean.length > maxLen) clean = `${clean.slice(0, maxLen)} [truncated]`;

  const matched: string[] = [];
  for (const p of INJECTION_PATTERNS) {
    if (p.test(clean)) matched.push(p.source.slice(0, 40));
  }
  return { clean, injectionDetected: matched.length > 0, matched };
}
