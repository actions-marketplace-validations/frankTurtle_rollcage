import { describe, expect, it } from 'vitest';
import { Redactor, assertClean, luhnValid } from '@adl/shared';
import { PLANTED } from '../src/sample-bundle.js';

describe('AC-3 every redaction type is detected', () => {
  for (const planted of PLANTED) {
    it(`${planted.type}: ${planted.snippet.slice(0, 18)}`, () => {
      const redactor = new Redactor();
      const out = redactor.redact(`before ${planted.snippet} after`);
      expect(out).not.toContain(planted.value);
      expect(out.startsWith('before ')).toBe(true);
      expect(out.endsWith(' after')).toBe(true);
      expect(redactor.report().byType[planted.type]?.occurrences).toBeGreaterThanOrEqual(1);
    });
  }

  it('covers every type the README lists', () => {
    const types = new Set(PLANTED.map((p) => p.type));
    for (const t of [
      'private-key',
      'bearer-token',
      'jwt',
      'github-token',
      'aws-access-key',
      'credential-assignment',
      'email',
      'credit-card',
      'ipv4',
      'ipv6',
      'phone',
    ]) {
      expect(types.has(t as never)).toBe(true);
    }
  });

  it('detects ASIA keys, GitHub fine-grained tokens, compressed IPv6 and Amex cards', () => {
    const r = new Redactor();
    const out = r.redact(
      [
        'ASIAIOSFODNN7EXAMPLE',
        `github_pat_${'A1b2C3d4E5'.repeat(3)}`,
        'fe80::1',
        '3782 822463 10005',
      ].join(' | '),
    );
    expect(out).toBe('[AWS_ACCESS_KEY_1] | [GITHUB_TOKEN_1] | [IPV6_1] | [CARD_1]');
  });
});

describe('AC-4 placeholders and false positives', () => {
  it('gives the same value the same placeholder and different values different ones', () => {
    const r = new Redactor();
    const out = r.redact('a@example.com b@example.com a@example.com');
    expect(out).toBe('[EMAIL_1] [EMAIL_2] [EMAIL_1]');
    expect(r.report().byType['email']).toEqual({ occurrences: 3, unique: 2 });
  });

  it('keeps placeholders stable across calls on one redactor', () => {
    const r = new Redactor();
    r.redact('203.0.113.9');
    expect(r.redact('seen 203.0.113.9 again')).toBe('seen [IPV4_1] again');
  });

  it('leaves a card-like number that fails Luhn alone', () => {
    expect(luhnValid('4111111111111111')).toBe(true);
    expect(luhnValid('4111111111111112')).toBe(false);
    const r = new Redactor();
    expect(r.redact('order 4111 1111 1111 1112 queued')).toBe('order 4111 1111 1111 1112 queued');
    expect(r.report().total).toBe(0);
  });

  it('does not mistake timestamps, epoch values, versions or times for personal data', () => {
    const text =
      'at 2026-03-04T14:05:00.000+01:00 epoch 1772632980000 v1.2.3 build 20260304 took 14:05:33 ids 123456789012';
    const r = new Redactor();
    expect(r.redact(text)).toBe(text);
  });

  it('redacts only the value of a credential assignment, including JSON, and skips placeholders', () => {
    const r = new Redactor();
    expect(r.redact('retry password=hunter2hunter2 now')).toBe('retry password=[SECRET_1] now');
    expect(r.redact('{"api_key": "sk_demo_0123456789"}')).toBe('{"api_key": "[SECRET_2]"}');
    expect(r.redact('token: [GITHUB_TOKEN_1]')).toBe('token: [GITHUB_TOKEN_1]');
    expect(r.redact('password=ab')).toBe('password=ab');
  });

  it('redacts a private key block spanning lines as one value', () => {
    const key = [
      '-----BEGIN ',
      'RSA PRIVATE KEY-----\nAAAA\nBBBB\n-----END ',
      'RSA PRIVATE KEY-----',
    ].join('');
    const r = new Redactor();
    expect(r.redact(`k:\n${key}\nend`)).toBe('k:\n[PRIVATE_KEY_1]\nend');
  });
});

describe('AC-8 redaction report', () => {
  it('has counts and types only, never values', () => {
    const r = new Redactor();
    r.redact(PLANTED.map((p) => p.snippet).join('\n'));
    const json = JSON.stringify(r.report());
    for (const p of PLANTED) expect(json).not.toContain(p.value);
    expect(r.report().total).toBeGreaterThanOrEqual(PLANTED.length);
    expect(Object.keys(r.report().byType).sort()).toEqual(
      [...new Set(PLANTED.map((p) => p.type))].sort(),
    );
  });
});

describe('assertClean', () => {
  it('passes redacted text and throws, without echoing the value, on raw text', () => {
    const r = new Redactor();
    expect(() => assertClean(r.redact('mail a@example.com'))).not.toThrow();
    expect(() => assertClean('mail a@example.com')).toThrow(/email/);
    expect(() => assertClean('mail a@example.com')).not.toThrow(/a@example/);
  });
});
