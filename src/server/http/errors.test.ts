import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from './errors';

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}

describe('ERROR_CODES', () => {
  it('lists every error code the server can return (documented in /openapi.json)', () => {
    const used = new Set<string>();
    for (const file of sources(join(process.cwd(), 'src/server'))) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/(?:new HttpError\(\d+, |HttpError\.(?:conflict|forbidden)\([^)]*?)'([A-Z][A-Z_]+)'/g)) used.add(m[1]!);
      for (const m of text.matchAll(/envelope\('([A-Z][A-Z_]+)'/g)) used.add(m[1]!);
    }
    expect(used.size).toBeGreaterThan(10);
    for (const code of used) expect(ERROR_CODES, code).toContain(code);
  });
});
