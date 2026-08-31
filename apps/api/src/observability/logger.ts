import pino, { type Logger as PinoLogger } from 'pino';
import type { AppConfig } from '../config/env';

export type Logger = PinoLogger;

/**
 * One shared structured logger. Secrets are never passed to it, and the redact
 * list is a second line of defence against accidental credential leakage.
 */
export function createLogger(config: AppConfig): Logger {
  const usePretty = config.log.pretty && config.env !== 'production';
  return pino({
    level: config.log.level,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers["x-razorpay-signature"]',
        'keySecret',
        'webhookSecret',
        'apiKey',
        '*.keySecret',
        '*.webhookSecret',
        '*.apiKey',
        '*.authorization',
      ],
      censor: '[redacted]',
    },
    transport: usePretty
      ? { target: 'pino-pretty', options: { translateTime: 'SYS:standard', ignore: 'pid,hostname' } }
      : undefined,
  });
}
