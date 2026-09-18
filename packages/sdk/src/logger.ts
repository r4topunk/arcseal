// Structured logging (pino). Works in Node and, through pino's browser build, in the web app.
// The SDK never logs at import time: callers create a logger, or functions create one on demand.

import type { DestinationStream, Logger } from 'pino';
import pino from 'pino';

export type { Logger } from 'pino';

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface CreateLoggerOptions {
  /** Minimum level. Default: `defaultLogLevel()`. */
  level?: LogLevel | undefined;
  /** `name` field on every line. Default 'arcseal'. */
  name?: string | undefined;
  /** Extra fields on every line. */
  bindings?: Record<string, unknown> | undefined;
  /** Node only: where lines go (default stdout). Ignored by pino's browser build, which logs to the console. */
  destination?: DestinationStream | undefined;
}

function readEnv(name: string): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.[name];
}

function isLogLevel(value: string | undefined): value is LogLevel {
  return value !== undefined && (LOG_LEVELS as readonly string[]).includes(value);
}

/**
 * `LOG_LEVEL` from the environment when it is a valid level; otherwise 'silent' under Vitest or NODE_ENV=test,
 * and 'info' everywhere else. In the browser there is no environment, so the default is 'info'.
 */
export function defaultLogLevel(): LogLevel {
  const fromEnv = readEnv('LOG_LEVEL');
  if (isLogLevel(fromEnv)) return fromEnv;
  if (readEnv('VITEST') || readEnv('NODE_ENV') === 'test') return 'silent';
  return 'info';
}

/** New pino logger. JSON lines in Node (`{ level, time, name, ...bindings, msg }`), objects in the browser console. */
export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const config = {
    level: options.level ?? defaultLogLevel(),
    base: { name: options.name ?? 'arcseal', ...options.bindings },
    browser: { asObject: true },
  };
  return options.destination ? pino(config, options.destination) : pino(config);
}

/** Random correlation id (UUID v4 layout) from `crypto.getRandomValues`, which also works outside secure contexts. */
export function newCorrelationId(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Child logger that stamps `correlationId` on every line (one per unsealProposal call). */
export function withCorrelationId(logger: Logger, correlationId: string = newCorrelationId()): Logger {
  return logger.child({ correlationId });
}
