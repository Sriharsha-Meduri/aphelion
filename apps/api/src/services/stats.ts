import type { Repositories } from '../repositories/types';
import type { Paise } from '../util/money';

export interface RecoveryStats {
  revenueAtRisk: Paise;
  revenueRecovered: Paise;
  recoveryRateByValue: number;
  recoveryRateByCount: number;
  totalCases: number;
  activeCases: number;
  successfulRecoveries: number;
  stoppedCases: number;
  escalatedCases: number;
  interventions: number;
  recoveryEfficiencyPaise: Paise;
  avgRecoveryMinutes: number;
  byState: Record<string, number>;
}

const ACTIVE = new Set(['open', 'assessed', 'decided', 'link_created', 'attempted', 'escalated']);

export async function computeStats(repos: Repositories, merchantId: string): Promise<RecoveryStats> {
  const cases = await repos.cases.list({ merchantId, limit: 100000 });
  let atRisk = 0;
  let recovered = 0;
  let active = 0;
  let recoveredCount = 0;
  let stopped = 0;
  let escalated = 0;
  let totalMs = 0;
  let msCount = 0;
  const byState: Record<string, number> = {};

  for (const c of cases) {
    atRisk += c.amountAtRisk;
    recovered += c.recoveredAmount;
    byState[c.state] = (byState[c.state] ?? 0) + 1;
    if (ACTIVE.has(c.state)) active += 1;
    if (c.escalated) escalated += 1;
    if (c.state === 'stopped') stopped += 1;
    if (c.state === 'recovered') {
      recoveredCount += 1;
      if (c.closedAt) {
        totalMs += c.closedAt.getTime() - c.openedAt.getTime();
        msCount += 1;
      }
    }
  }

  const interventions = await repos.interventions.countActionsSince(merchantId, new Date(0));

  return {
    revenueAtRisk: atRisk,
    revenueRecovered: recovered,
    recoveryRateByValue: atRisk > 0 ? recovered / atRisk : 0,
    recoveryRateByCount: cases.length > 0 ? recoveredCount / cases.length : 0,
    totalCases: cases.length,
    activeCases: active,
    successfulRecoveries: recoveredCount,
    stoppedCases: stopped,
    escalatedCases: escalated,
    interventions,
    recoveryEfficiencyPaise: interventions > 0 ? Math.round(recovered / interventions) : 0,
    avgRecoveryMinutes: msCount > 0 ? Math.round(totalMs / msCount / 60000) : 0,
    byState,
  };
}
