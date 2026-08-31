import 'dotenv/config';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateDataset, DEFAULT_DATASET } from './generator';

/** Generate the synthetic dataset and write a summary plus a sample for inspection. */
function main(): void {
  const ds = generateDataset(DEFAULT_DATASET);
  const bySplit = { train: 0, val: 0, test: 0 };
  const byCategory: Record<string, number> = {};
  for (const s of ds) {
    bySplit[s.split] += 1;
    byCategory[s.failureCategory] = (byCategory[s.failureCategory] ?? 0) + 1;
  }
  const positives = ds.filter((s) => s.labelRecoverIfLink === 1).length;
  const summary = {
    seed: DEFAULT_DATASET.seed,
    numCases: ds.length,
    bySplit,
    byCategory,
    baseRate: Math.round((positives / ds.length) * 10000) / 10000,
    sample: ds.slice(0, 15),
  };
  mkdirSync(resolve(process.cwd(), 'data'), { recursive: true });
  writeFileSync(resolve(process.cwd(), 'data', 'dataset.json'), JSON.stringify(summary, null, 2));
  console.log('[dataset]', JSON.stringify({ ...summary, sample: undefined }, null, 2));
}

main();
