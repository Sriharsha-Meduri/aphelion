import 'dotenv/config';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { resolveSsl } from './pool';

/**
 * Transparent SQL migration runner. Applies every *.sql file in filename order,
 * each inside its own transaction, recording applied files in schema_migrations.
 * Re-running is safe, so the schema is reproducible from a fresh database.
 *
 * Usage: tsx src/db/migrate.ts up|status   (prod: node dist/db/migrate.js up)
 */
function getConfig() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error('DATABASE_URL is not set; cannot run migrations.');
  const mode = (process.env.DATABASE_SSL?.trim().toLowerCase() as 'auto' | 'require' | 'disable') || 'auto';
  const dir = resolve(process.cwd(), process.env.MIGRATIONS_DIR?.trim() || 'migrations');
  return { url, ssl: resolveSsl(url, mode === 'require' || mode === 'disable' ? mode : 'auto'), dir };
}

function listFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, 'en'));
}

async function ensureTable(client: Client): Promise<void> {
  await client.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());`,
  );
}

async function applied(client: Client): Promise<Set<string>> {
  const { rows } = await client.query<{ filename: string }>('SELECT filename FROM schema_migrations');
  return new Set(rows.map((r) => r.filename));
}

async function up(): Promise<void> {
  const { url, ssl, dir } = getConfig();
  const files = listFiles(dir);
  const client = new Client({ connectionString: url, ssl });
  await client.connect();
  try {
    await ensureTable(client);
    const done = await applied(client);
    const pending = files.filter((f) => !done.has(f));
    if (pending.length === 0) {
      console.log(`[migrate] up to date (${files.length} applied).`);
      return;
    }
    for (const file of pending) {
      const sql = readFileSync(resolve(dir, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`[migrate] applied ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`, { cause: err });
      }
    }
    console.log(`[migrate] done (${pending.length} applied).`);
  } finally {
    await client.end();
  }
}

async function status(): Promise<void> {
  const { url, ssl, dir } = getConfig();
  const files = listFiles(dir);
  const client = new Client({ connectionString: url, ssl });
  await client.connect();
  try {
    await ensureTable(client);
    const done = await applied(client);
    for (const f of files) console.log(`${done.has(f) ? '[x]' : '[ ]'} ${f}`);
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? 'up';
  if (cmd === 'up') await up();
  else if (cmd === 'status') await status();
  else {
    console.error(`Unknown command: ${cmd}. Use "up" or "status".`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`[migrate] ERROR: ${(err as Error).message}`);
  process.exit(1);
});
