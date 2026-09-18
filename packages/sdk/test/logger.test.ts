import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger, defaultLogLevel, newCorrelationId, withCorrelationId } from '../src/index.js';

const capture = () => {
  const lines: Record<string, unknown>[] = [];
  return { lines, destination: { write: (line: string) => void lines.push(JSON.parse(line)) } };
};

describe('logger', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is silent by default under Vitest', () => {
    vi.stubEnv('LOG_LEVEL', '');
    expect(defaultLogLevel()).toBe('silent');
    const { lines, destination } = capture();
    const log = createLogger({ destination });
    log.error('not written');
    expect(lines).toHaveLength(0);
  });

  it('honours a valid LOG_LEVEL and ignores an invalid one', () => {
    vi.stubEnv('LOG_LEVEL', 'debug');
    expect(defaultLogLevel()).toBe('debug');
    vi.stubEnv('LOG_LEVEL', 'loud');
    expect(defaultLogLevel()).toBe('silent');
  });

  it('child logger stamps the correlation id and the arcseal name on every line', () => {
    const { lines, destination } = capture();
    const log = withCorrelationId(createLogger({ level: 'info', destination }), 'corr-1');
    log.info({ proposalId: '7', sealed: 5 }, 'unseal start');
    log.debug('below level');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      name: 'arcseal',
      correlationId: 'corr-1',
      proposalId: '7',
      msg: 'unseal start',
    });
  });

  it('generates distinct UUID v4 correlation ids', () => {
    const ids = Array.from({ length: 32 }, newCorrelationId);
    for (const id of ids)
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(new Set(ids).size).toBe(32);
    const { lines, destination } = capture();
    withCorrelationId(createLogger({ level: 'info', destination })).info('x');
    expect(String(lines[0]?.correlationId)).toMatch(/^[0-9a-f-]{36}$/);
  });
});
