import 'dotenv/config';
import { loadConfig } from '../config/env';
import { createLogger } from '../observability/logger';
import { createContainer } from '../container';
import { computeStats } from '../services/stats';
import { seedDemo, type DemoDeps } from '../sim/demo-runner';
import { DEFAULT_MERCHANT_NAME } from '../pipeline/recovery-pipeline';
import { formatInr } from '../util/money';

/**
 * Seed a batch of synthetic failed payments through the full pipeline and print
 * a recovery summary. Usage: npm run seed -- [count]
 */
async function main(): Promise<void> {
  const count = Number(process.argv[2] ?? 40) || 40;
  const config = loadConfig();
  const logger = createLogger(config);
  const container = createContainer(config, logger);
  const deps: DemoDeps = {
    pipeline: container.pipeline,
    repos: container.repos,
    config: container.config,
    razorpay: container.razorpay,
    model: container.model,
    logger: container.logger,
  };

  const seeded = await seedDemo(deps, count);
  const merchant = await container.repos.merchants.getOrCreate(DEFAULT_MERCHANT_NAME);
  const stats = await computeStats(container.repos, merchant.id);

  process.stdout.write(
    [
      '',
      `Seeded ${seeded} failed payments through the recovery pipeline.`,
      `  revenue at risk    ${formatInr(stats.revenueAtRisk)}`,
      `  revenue recovered  ${formatInr(stats.revenueRecovered)} (${(stats.recoveryRateByValue * 100).toFixed(1)}% of value)`,
      `  recovered cases    ${stats.successfulRecoveries}/${stats.totalCases}`,
      `  contacts made      ${stats.interventions}`,
      `  recovered/contact  ${formatInr(stats.recoveryEfficiencyPaise)}`,
      `  escalated / stopped ${stats.escalatedCases} / ${stats.stoppedCases}`,
      '',
    ].join('\n'),
  );

  await container.shutdown(5000);
}

main().catch((err) => {
  console.error('seed failed:', (err as Error).message);
  process.exit(1);
});
