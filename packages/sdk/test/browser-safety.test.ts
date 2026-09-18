import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The SDK ships to browsers (apps/web) as well as Node 22: nothing under src/ may import a Node built-in.
const NODE_BUILTINS =
  /from\s+['"](node:[^'"]+|fs|path|os|crypto|buffer|stream|util|url|child_process|worker_threads|http|https|net)['"]/;

describe('browser safety', () => {
  it('src/ has no Node built-in imports and no Buffer', () => {
    const dir = new URL('../src/', import.meta.url);
    const files = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(new URL(file, dir), 'utf8');
      expect(source, file).not.toMatch(NODE_BUILTINS);
      expect(source, file).not.toMatch(/\bBuffer\b/);
    }
  });
});
