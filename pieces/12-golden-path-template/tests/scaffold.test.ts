import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scaffold, ScaffoldError } from '../src/scaffold.ts';
import { tempDir, writeFile } from './helpers.ts';

const OPTS = { name: 'payments-api', owner: 'example-org' } as const;

function allFiles(root: string, rel = ''): string[] {
  return readdirSync(join(root, rel), { withFileTypes: true }).flatMap((e) => {
    const p = rel ? `${rel}/${e.name}` : e.name;
    return e.isDirectory() ? allFiles(root, p) : [p];
  });
}

describe('scaffold: generation (AC1)', () => {
  it('writes the template into a new directory and leaves no placeholder token', () => {
    const target = join(tempDir(), 'payments-api');
    const result = scaffold({ ...OPTS, targetDir: target });
    const files = allFiles(target);
    expect(files.sort()).toEqual([...result.files].sort());
    expect(files.length).toBeGreaterThan(20);
    for (const f of files) {
      const text = readFileSync(join(target, f), 'utf8');
      expect(text, f).not.toMatch(/__(NAME|OWNER|ROLLCAGE_REF)__/);
    }
  });

  it('substitutes name, owner and ref', () => {
    const target = join(tempDir(), 'svc');
    scaffold({ ...OPTS, targetDir: target, ref: 'v9.9.9' });
    expect(readFileSync(join(target, 'package.json'), 'utf8')).toContain('"name": "payments-api"');
    expect(readFileSync(join(target, '.github/CODEOWNERS'), 'utf8')).toContain('@example-org');
    expect(readFileSync(join(target, '.github/workflows/sbom-vuln.yml'), 'utf8')).toContain(
      'pieces/05-sbom-vuln-triage@v9.9.9',
    );
  });

  it('defaults the ref to v0.3.0 and renames gitignore to .gitignore', () => {
    const target = join(tempDir(), 'svc');
    scaffold({ ...OPTS, targetDir: target });
    expect(readFileSync(join(target, '.github/workflows/policy-gates.yml'), 'utf8')).toContain(
      'pieces/06-policy-gates@v0.3.0',
    );
    expect(existsSync(join(target, '.gitignore'))).toBe(true);
    expect(existsSync(join(target, 'gitignore'))).toBe(false);
  });

  it('contains the governance files (AC7)', () => {
    const target = join(tempDir(), 'svc');
    scaffold({ ...OPTS, targetDir: target });
    for (const f of [
      '.pre-commit-config.yaml',
      '.github/CODEOWNERS',
      '.github/pull_request_template.md',
      '.github/dependabot.yml',
      'SECURITY.md',
      'docs/branch-protection.md',
      '.golden-path.json',
    ]) {
      expect(existsSync(join(target, f)), f).toBe(true);
    }
    expect(readFileSync(join(target, '.github/dependabot.yml'), 'utf8')).toContain(
      'github-actions',
    );
    expect(readFileSync(join(target, '.pre-commit-config.yaml'), 'utf8')).toContain('gitleaks');
  });

  it('warns when the ref is not a commit SHA and stays quiet when it is', () => {
    const a = scaffold({ ...OPTS, targetDir: join(tempDir(), 'a') });
    expect(a.warnings.join(' ')).toMatch(/not a commit SHA/);
    const b = scaffold({
      ...OPTS,
      targetDir: join(tempDir(), 'b'),
      ref: '0123456789abcdef0123456789abcdef01234567',
    });
    expect(b.warnings).toEqual([]);
  });
});

describe('scaffold: non-empty directories (AC2)', () => {
  it('refuses a directory with a file and writes nothing', () => {
    const target = tempDir();
    writeFile(target, 'keep.txt', 'mine');
    expect(() => scaffold({ ...OPTS, targetDir: target })).toThrow(ScaffoldError);
    expect(readdirSync(target)).toEqual(['keep.txt']);
  });

  it('refuses a directory that holds only a dotfile', () => {
    const target = tempDir();
    writeFile(target, '.env', 'X=1');
    expect(() => scaffold({ ...OPTS, targetDir: target })).toThrow(/not empty/);
  });

  it('refuses a path that is a file', () => {
    const dir = tempDir();
    writeFile(dir, 'afile', 'x');
    expect(() => scaffold({ ...OPTS, targetDir: join(dir, 'afile') })).toThrow(/not a directory/);
  });

  it('accepts an existing empty directory', () => {
    const target = join(tempDir(), 'empty');
    mkdirSync(target);
    expect(scaffold({ ...OPTS, targetDir: target }).files.length).toBeGreaterThan(0);
  });

  it('a second scaffold into the same directory is refused', () => {
    const target = join(tempDir(), 'svc');
    scaffold({ ...OPTS, targetDir: target });
    expect(() => scaffold({ ...OPTS, targetDir: target })).toThrow(/not empty/);
  });
});

describe('scaffold: input validation (AC3)', () => {
  it.each([
    ['name', { name: 'Payments' }, /name/],
    ['name leading digit', { name: '1api' }, /name/],
    ['name too long', { name: 'a'.repeat(65) }, /name/],
    ['name with slash', { name: '../x' }, /name/],
    ['owner', { owner: 'bad owner' }, /owner/],
    ['owner leading hyphen', { owner: '-x' }, /owner/],
    ['ref with space', { ref: 'v1 0' }, /ref/],
    ['ref empty', { ref: '' }, /ref/],
    ['ref with quote', { ref: "v1'" }, /ref/],
  ])('rejects an invalid %s and writes nothing', (_label, patch, message) => {
    const target = join(tempDir(), 'svc');
    expect(() => scaffold({ ...OPTS, targetDir: target, ...patch })).toThrow(message);
    expect(existsSync(target)).toBe(false);
  });
});
