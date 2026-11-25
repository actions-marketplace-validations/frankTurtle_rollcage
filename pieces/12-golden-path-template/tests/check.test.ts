import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkProject, percentOnPath } from '../src/check.ts';
import { scaffold } from '../src/scaffold.ts';
import { tempDir, writeFile } from './helpers.ts';

function scaffolded(): string {
  const dir = join(tempDir(), 'svc');
  scaffold({ name: 'svc', owner: 'example-org', targetDir: dir });
  return dir;
}

describe('check (AC8)', () => {
  it('reports a scaffolded project as on the path', () => {
    const result = checkProject(scaffolded());
    expect(result).toMatchObject({ onPath: true, missing: [], pinErrors: [] });
  });

  it('reports an empty directory as off the path with the missing files', () => {
    const result = checkProject(tempDir());
    expect(result.onPath).toBe(false);
    expect(result.missing).toContain('.github/workflows/ci.yml');
    expect(result.missing).toContain('.github/CODEOWNERS');
  });

  it('reports a missing path as off the path', () => {
    expect(checkProject(join(tempDir(), 'nope')).onPath).toBe(false);
  });

  it('reports a deleted workflow', () => {
    const dir = scaffolded();
    rmSync(join(dir, '.github/workflows/sbom-vuln.yml'));
    const result = checkProject(dir);
    expect(result.onPath).toBe(false);
    expect(result.missing).toEqual(['.github/workflows/sbom-vuln.yml']);
  });

  it('reports an unpinned action as off the path', () => {
    const dir = scaffolded();
    writeFile(dir, '.github/workflows/extra.yml', 'steps:\n  - uses: actions/checkout@v4\n');
    const result = checkProject(dir);
    expect(result.onPath).toBe(false);
    expect(result.pinErrors).toHaveLength(1);
  });

  it('computes the percentage across directories', () => {
    const empty = join(tempDir(), 'empty');
    mkdirSync(empty);
    const results = [scaffolded(), empty, scaffolded(), empty].map(checkProject);
    expect(percentOnPath(results)).toBe(50);
    expect(percentOnPath([])).toBe(0);
  });
});
