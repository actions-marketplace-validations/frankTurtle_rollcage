import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT, readPiece } from './helpers.ts';

describe('AC10: pilot plan', () => {
  const pilot = readPiece('PILOT.md');

  it('names the five delivery metrics exactly as piece 03 reports them', () => {
    const piece03 = readFileSync(join(REPO_ROOT, 'pieces', '03-dora-metrics', 'README.md'), 'utf8');
    const names = [
      'Deployment frequency',
      'Change lead time',
      'Change fail rate',
      'Failed deployment recovery time',
      'Deployment rework rate',
    ];
    for (const name of names) {
      expect(piece03).toContain(`| ${name}`);
      expect(pilot).toContain(name);
    }
  });

  it('describes the before and after split with piece 03 flags', () => {
    expect(pilot).toContain('--compare-at');
    expect(pilot).toContain('--since');
    expect(pilot).toContain('--until');
    expect(pilot).toMatch(/Before window/);
    expect(pilot).toMatch(/After window/);
  });

  it('states the sample size caveat and the decision rule', () => {
    expect(pilot).toContain('min_samples');
    expect(pilot).toMatch(/not a statistical threshold/);
    expect(pilot).toMatch(/^## Decision rule/m);
    expect(pilot).toMatch(/no decision yet/);
  });
});
