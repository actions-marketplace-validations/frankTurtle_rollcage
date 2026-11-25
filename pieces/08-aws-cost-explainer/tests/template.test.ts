import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('AC-13 SAM template guardrails', () => {
  const template = read('template.yaml');

  it('uses nodejs24.x on arm64, from the bundled folder', () => {
    expect(template).toContain('Runtime: nodejs24.x');
    expect(template).toContain('Architectures: [arm64]');
    expect(template).toContain('CodeUri: dist/lambda');
    expect(read('scripts/build-lambda.mjs')).toContain("outfile: 'dist/lambda/index.mjs'");
  });

  it('grants exactly the two Cost Explorer read actions and no wildcard action', () => {
    const ce = template.match(/ce:[A-Za-z*]+/g);
    expect(ce).toEqual(['ce:GetCostAndUsage', 'ce:GetAnomalies']);
    expect(template).not.toMatch(/Action:\s*['"]?\*/);
    expect(template).not.toMatch(/:\*['"\s]*$/m);
    expect(template).not.toMatch(/AdministratorAccess|PowerUser/);
  });

  it('defaults to fixture data and a weekly schedule', () => {
    expect(template).toMatch(/DataSource:\s*\n\s*Type: String\s*\n\s*Default: fixture/);
    expect(template).toContain('ScheduleV2');
    expect(template).toMatch(/Default: 'cron\(0 8 \? \* MON \*\)'/);
  });

  it('holds no webhook URL, key or account id', () => {
    expect(template).not.toMatch(/hooks\.slack\.com/);
    expect(template).not.toMatch(/sk-ant-|AKIA[0-9A-Z]{16}/);
    expect(template).not.toMatch(/\b\d{12}\b/);
  });

  it('reads the webhook and model key only from Secrets Manager parameters', () => {
    expect(template).toContain('SlackWebhookSecretArn');
    expect(template).toContain('AnthropicKeySecretArn');
    expect(template).toContain('secretsmanager:GetSecretValue');
  });
});
