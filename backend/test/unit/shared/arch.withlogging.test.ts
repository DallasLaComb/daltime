import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

function findHandlers(dir: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      result.push(...findHandlers(full));
    } else if (entry === 'handler.ts') {
      result.push(full);
    }
  }
  return result;
}

const SRC = resolve(import.meta.dirname, '../../../src/functions');
const handlers = findHandlers(SRC);

describe('architecture: every handler.ts exports via withLogging', () => {
  it('found handler files', () => {
    expect(handlers.length).toBeGreaterThan(0);
  });

  for (const file of handlers) {
    const label = file.slice(SRC.length + 1);
    it(label, () => {
      const src = readFileSync(file, 'utf8');
      expect(src, `${label} must export handler via withLogging`).toMatch(/withLogging/);
    });
  }
});
