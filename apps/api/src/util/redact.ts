/**
 * PII minimization for logs. Contact details are the customer identity here, so
 * they are masked in logs by default. Full values live only in the database.
 */

export function redactContact(value: string | null | undefined): string {
  if (!value) return '<none>';
  const s = String(value);
  if (s.includes('@')) {
    const [user, domain] = s.split('@');
    const head = user.slice(0, 2);
    return `${head}${'*'.repeat(Math.max(1, user.length - 2))}@${domain}`;
  }
  if (s.length <= 4) return '*'.repeat(s.length);
  return `${s.slice(0, 2)}${'*'.repeat(Math.max(0, s.length - 6))}${s.slice(-4)}`;
}

/** Anonymized, stable key for a customer, safe to show in dashboards and logs. */
export function customerKey(contact: string): string {
  const digits = contact.replace(/\D/g, '');
  const tail = digits.slice(-4) || contact.slice(-4);
  return `cust_****${tail}`;
}
