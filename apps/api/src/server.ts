import 'dotenv/config';
import { loadConfig } from './config/env';
import { createLogger } from './observability/logger';
import { createContainer } from './container';
import { buildApp } from './http/app';
import { Events } from './observability/events';
import { toErrorInfo } from './util/errors';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const container = createContainer(config, logger);
  const app = buildApp(container);

  await app.listen({ port: config.port, host: config.host });
  logger.info(
    {
      event: Events.SERVER_STARTED,
      port: config.port,
      host: config.host,
      env: config.env,
      dbDriver: config.db.driver,
      razorpayMode: config.razorpay.mode,
      llmProvider: config.llm.provider,
      model: container.model ? container.model.version : 'heuristic-prior-v1',
    },
    'RecoverAI API is up',
  );

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ event: Events.SERVER_SHUTDOWN, signal }, 'shutting down');
    const hard = setTimeout(() => {
      logger.error({ event: Events.SERVER_SHUTDOWN }, 'forced exit');
      process.exit(1);
    }, 70000);
    hard.unref();
    try {
      await app.close();
      await container.shutdown(60000);
      clearTimeout(hard);
      process.exit(0);
    } catch (err) {
      logger.error({ event: Events.SERVER_SHUTDOWN, err: toErrorInfo(err) }, 'shutdown error');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) =>
    logger.error({ event: 'UNHANDLED_REJECTION', err: toErrorInfo(reason) }, 'unhandled rejection'),
  );
}

main().catch((err) => {
  console.error('Fatal startup error:\n', (err as Error).message);
  process.exit(1);
});
