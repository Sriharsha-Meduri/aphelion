import 'dotenv/config';
import { loadConfig } from '../config/env';
import { createLogger } from '../observability/logger';
import { createContainer } from '../container';
import { runScenario, SCENARIOS, type DemoDeps } from '../sim/demo-runner';

/**
 * Run the named recovery scenarios end to end and print what each demonstrates.
 * Usage: npm run demo -- [scenario]   (defaults to running all of them)
 */
async function main(): Promise<void> {
  const only = process.argv[2];
  const names = only ? [only] : [...SCENARIOS];

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

  process.stdout.write('\nRunning recovery scenarios:\n\n');
  for (const name of names) {
    const result = await runScenario(deps, name);
    process.stdout.write(`  [${result.scenario}]\n    ${result.note}\n\n`);
  }

  await container.shutdown(5000);
}

main().catch((err) => {
  console.error('scenario run failed:', (err as Error).message);
  process.exit(1);
});
