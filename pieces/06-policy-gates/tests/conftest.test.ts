import { describe, expect, it } from 'vitest';
import {
  createConftestRunner,
  parseConftestOutput,
  toViolations,
  type ExecFn,
} from '../src/conftest.js';
import { loadMapping } from '../src/mapping.js';
import { MAPPING_PATH, POLICY_DIR, SAMPLE_CONFTEST_JSON } from './helpers.js';

const mapping = loadMapping(MAPPING_PATH);

describe('parseConftestOutput', () => {
  it('returns only failures, with their file, and ignores warnings', () => {
    const failures = parseConftestOutput(SAMPLE_CONFTEST_JSON);
    expect(failures).toHaveLength(3);
    expect(failures.map((f) => f.file)).toContain('.github/workflows/deploy.yml');
    expect(failures.some((f) => f.msg.startsWith('PG999'))).toBe(false);
  });

  it('returns nothing for a clean run', () => {
    expect(parseConftestOutput('[{"filename":"a.json","namespace":"x","successes":3}]')).toEqual(
      [],
    );
  });

  it('throws on output that is not conftest JSON', () => {
    expect(() => parseConftestOutput('not json')).toThrow(/conftest output/i);
    expect(() => parseConftestOutput('{"a":1}')).toThrow(/conftest output/i);
  });
});

describe('toViolations', () => {
  const violations = toViolations(parseConftestOutput(SAMPLE_CONFTEST_JSON), mapping);

  it('attaches NIST control IDs, title and fix from the mapping', () => {
    const pg1 = violations.find((v) => v.ruleId === 'PG001');
    expect(pg1?.controls).toEqual(['3.1.3', '3.1.22', '3.13.1']);
    expect(pg1?.title).toBe('No public S3 buckets');
    expect(pg1?.remediation).toMatch(/private ACL/);
    expect(pg1?.message).toBe('aws_s3_bucket.assets has the public ACL "public-read"');
  });

  it('sorts by file, then rule ID, so output is stable', () => {
    expect(violations.map((v) => `${v.file}|${v.ruleId}`)).toEqual([
      '.github/workflows/deploy.yml|PG004',
      'infra/plan.json|PG001',
      'infra/plan.json|PG003',
    ]);
  });

  it('keeps a violation whose rule has no mapping, with no controls', () => {
    const [v] = toViolations([{ file: 'a.yml', msg: 'PG042: custom rule fired' }], mapping);
    expect(v).toMatchObject({ ruleId: 'PG042', controls: [], message: 'custom rule fired' });
  });

  it('keeps a message that has no rule ID prefix', () => {
    const [v] = toViolations([{ file: 'a.yml', msg: 'something is wrong' }], mapping);
    expect(v).toMatchObject({ ruleId: 'UNKNOWN', controls: [], message: 'something is wrong' });
  });
});

describe('createConftestRunner', () => {
  const options = { paths: ['a.json', 'dir'], policy: POLICY_DIR, ignore: 'node_modules' };

  it('runs conftest with JSON output across all namespaces', async () => {
    const calls: { file: string; args: string[] }[] = [];
    const exec: ExecFn = async (file, args) => {
      calls.push({ file, args });
      return { stdout: '[]', stderr: '', code: 0 };
    };
    await expect(createConftestRunner(exec).run(options)).resolves.toBe('[]');
    expect(calls[0]?.file).toBe('conftest');
    expect(calls[0]?.args).toEqual([
      'test',
      '--all-namespaces',
      '--no-color',
      '-o',
      'json',
      '-p',
      POLICY_DIR,
      '--ignore',
      'node_modules',
      'a.json',
      'dir',
    ]);
  });

  it('returns stdout when conftest exits 1 because of violations', async () => {
    const exec: ExecFn = async () => ({ stdout: SAMPLE_CONFTEST_JSON, stderr: '', code: 1 });
    await expect(createConftestRunner(exec).run(options)).resolves.toBe(SAMPLE_CONFTEST_JSON);
  });

  it('throws with stderr when conftest fails without output', async () => {
    const exec: ExecFn = async () => ({ stdout: '', stderr: 'policy parse error', code: 2 });
    await expect(createConftestRunner(exec).run(options)).rejects.toThrow(/policy parse error/);
  });

  it('says how to install conftest when it is not on PATH', async () => {
    const exec: ExecFn = async () => {
      throw Object.assign(new Error('spawn conftest ENOENT'), { code: 'ENOENT' });
    };
    await expect(createConftestRunner(exec).run(options)).rejects.toThrow(/conftest.*PATH/i);
  });

  it('passes other spawn errors through', async () => {
    const exec: ExecFn = async () => {
      throw new Error('boom');
    };
    await expect(createConftestRunner(exec).run(options)).rejects.toThrow('boom');
  });
});
