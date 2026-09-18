// Browser smoke test (PRD 8.2, settles PRD 14's Buffer question): runs the `vite build` CLI on index.html + main.ts
// with no config file (no polyfill plugins, no target override) in a clean production env, serves the output from a
// local static server and runs it in headless Playwright Chromium. Offline: the page only loads local files.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('.', import.meta.url));
const viteCli = join(dirname(createRequire(import.meta.url).resolve('vite/package.json')), 'bin/vite.js');
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
};

let outDir = '';
let origin = '';
let server: Server | undefined;
let browser: Browser | undefined;
let buildOutput = '';

function serve(dir: string): Promise<Server> {
  const httpServer = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)).replace(
      /^[/\\]+/,
      '',
    );
    if (path.startsWith('..')) {
      res.writeHead(403).end();
      return;
    }
    try {
      const file = join(dir, path === '' ? 'index.html' : path);
      const body = readFileSync(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve(httpServer)));
}

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), 'arcseal-tlock-smoke-'));
  // A consumer's build runs outside vitest: drop NODE_ENV=test and VITEST* so Vite behaves as in production.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key !== 'NODE_ENV' && !key.startsWith('VITEST')),
  );
  const result = spawnSync(process.execPath, [viteCli, 'build', root, '--outDir', outDir, '--emptyOutDir'], {
    env,
    encoding: 'utf8',
  });
  buildOutput = `${result.stdout}${result.stderr}`;
  if (result.status !== 0) throw new Error(`vite build failed:\n${buildOutput}`);
  server = await serve(outDir);
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch({ headless: true });
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await new Promise((resolve) => (server ? server.close(resolve) : resolve(undefined)));
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

describe('browser smoke (Vite build + headless Chromium)', () => {
  it('bundles with no Node builtin externalized and no Buffer warning', () => {
    expect(buildOutput).toContain('built in');
    expect(buildOutput).not.toMatch(/externalized for browser compatibility|buffer/i);
  });

  it('encrypts, decrypts and opens the tle vectors in Chromium with zero console errors', async () => {
    const page = await browser!.newPage();
    const consoleErrors: string[] = [];
    const offsite: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(error.message));
    page.on('request', (request) => {
      if (!request.url().startsWith(origin) && !request.url().startsWith('data:'))
        offsite.push(request.url());
    });

    await page.goto(`${origin}/`);
    await page.waitForSelector('#result[data-status]', { timeout: 60_000 });
    const status = await page.getAttribute('#result', 'data-status');
    const log = (await page.textContent('#log')) ?? '';

    expect(status, log).toBe('pass');
    expect(await page.textContent('#result')).toBe('PASS');
    expect(log).toContain('ok   decrypt tle v1.2.0 vector dao-vote-for');
    expect(consoleErrors).toEqual([]);
    expect(offsite).toEqual([]);
    await page.close();
  });
});
