import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach } from 'vitest';

const made: string[] = [];

/** A fresh temp directory, removed after each test. */
export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'golden-path-'));
  made.push(dir);
  return dir;
}

export function writeFile(root: string, rel: string, text: string): void {
  const full = join(root, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
}

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});
