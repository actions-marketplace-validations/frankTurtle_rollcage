export type RedactionType =
  | 'private-key'
  | 'bearer-token'
  | 'jwt'
  | 'github-token'
  | 'slack-token'
  | 'api-key'
  | 'aws-access-key'
  | 'credential-assignment'
  | 'email'
  | 'credit-card'
  | 'ipv6'
  | 'ipv4'
  | 'phone';

export interface RedactionReport {
  total: number;
  /** Counts only. Values are never stored in or derived from this object. */
  byType: Partial<Record<RedactionType, { occurrences: number; unique: number }>>;
}

const LABEL: Record<RedactionType, string> = {
  'private-key': 'PRIVATE_KEY',
  'bearer-token': 'BEARER_TOKEN',
  jwt: 'JWT',
  'github-token': 'GITHUB_TOKEN',
  'slack-token': 'SLACK_TOKEN',
  'api-key': 'API_KEY',
  'aws-access-key': 'AWS_ACCESS_KEY',
  'credential-assignment': 'SECRET',
  email: 'EMAIL',
  'credit-card': 'CARD',
  ipv6: 'IPV6',
  ipv4: 'IPV4',
  phone: 'PHONE',
};

export function luhnValid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return digits.length > 0 && sum % 10 === 0;
}

const H = '[0-9a-f]{1,4}';
const OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';

interface Rule {
  type: RedactionType;
  /** A credential, as opposed to personal data. `redactSecrets` applies only these. */
  secret?: true;
  pattern: RegExp;
  /** Capture group holding the secret when only part of the match is replaced (it ends the match). */
  group?: number;
  /** Return false to leave a match alone. */
  accept?: (value: string) => boolean;
}

/** Order matters: longer and more specific shapes first, so a token is not cut up by a later rule. */
const RULES: Rule[] = [
  {
    type: 'private-key',
    secret: true,
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },
  {
    type: 'bearer-token',
    secret: true,
    pattern: /\bBearer\s+(?=[A-Za-z0-9\-._~+/]*[\d\-._~+/])[A-Za-z0-9\-._~+/]{8,}=*/gi,
  },
  { type: 'jwt', secret: true, pattern: /\beyJ[\w-]{5,}\.eyJ[\w-]{5,}\.[\w-]{5,}/g },
  {
    type: 'github-token',
    secret: true,
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
  },
  { type: 'slack-token', secret: true, pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { type: 'api-key', secret: true, pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { type: 'aws-access-key', secret: true, pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  {
    type: 'credential-assignment',
    secret: true,
    pattern:
      /(\b[\w-]*(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?key|token)[\w-]*["']?\s*[=:]\s*["']?)(?!\[)([^\s"',;]{4,})/gi,
    group: 2,
  },
  {
    type: 'email',
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g,
  },
  {
    type: 'credit-card',
    pattern: /(?<!\d)(?:\d{4}[ -]\d{4}[ -]\d{4}[ -]\d{4}|\d{4}[ -]\d{6}[ -]\d{5}|\d{15,16})(?!\d)/g,
    accept: (value) => luhnValid(value.replace(/\D/g, '')),
  },
  {
    type: 'ipv6',
    pattern: new RegExp(
      `(?<![\\w:])(?:(?:${H}:){7}${H}|(?:${H}:){1,7}:(?:${H}(?::${H}){0,6})?|::(?:${H}:){0,6}${H})(?![\\w:])`,
      'gi',
    ),
  },
  {
    type: 'ipv4',
    pattern: new RegExp(`(?<![\\d.])(?:${OCTET}\\.){3}${OCTET}(?![\\d]|\\.\\d)`, 'g'),
  },
  {
    type: 'phone',
    pattern:
      /(?<![\w.+-])(?:\+\d{1,3}[ .-]?)?(?:\(\d{3}\)\s?|\d{3}[ .-])\d{3}[ .-]\d{4}(?![\w-])|(?<![\w.+])\+\d{1,3}(?:[ .-]?\d{2,4}){2,4}(?!\d)/g,
  },
];

/** Replace every match of one rule, keeping any text before the secret group. */
function replaceRule(rule: Rule, text: string, placeholder: (value: string) => string): string {
  return text.replace(rule.pattern, (...args: string[]) => {
    const full = args[0] as string;
    const value = rule.group ? (args[rule.group] as string) : full;
    if (rule.accept && !rule.accept(value)) return full;
    return full.slice(0, full.length - value.length) + placeholder(value);
  });
}

const SECRET_RULES = RULES.filter((rule) => rule.secret);

/** Replace secrets with `[REDACTED:type]` markers. Stateless: equal input gives equal output. */
export function redactSecrets(text: string): string {
  return SECRET_RULES.reduce(
    (out, rule) => replaceRule(rule, out, () => `[REDACTED:${rule.type}]`),
    text,
  );
}

/**
 * Replaces PII and secrets with stable placeholders such as `[EMAIL_1]`. The same value always
 * gets the same placeholder within one instance. It keeps counts and a value-to-placeholder map
 * in memory only; the report exposes counts, never values.
 */
export class Redactor {
  private readonly seen = new Map<RedactionType, Map<string, number>>();
  private readonly counts = new Map<RedactionType, number>();
  redact(text: string): string {
    return RULES.reduce(
      (out, rule) => replaceRule(rule, out, (value) => this.placeholder(rule.type, value)),
      text,
    );
  }

  private placeholder(type: RedactionType, value: string): string {
    let ids = this.seen.get(type);
    if (!ids) this.seen.set(type, (ids = new Map()));
    let id = ids.get(value);
    if (id === undefined) ids.set(value, (id = ids.size + 1));
    this.counts.set(type, (this.counts.get(type) ?? 0) + 1);
    return `[${LABEL[type]}_${id}]`;
  }

  report(): RedactionReport {
    const byType: RedactionReport['byType'] = {};
    let total = 0;
    for (const [type, occurrences] of this.counts) {
      byType[type] = { occurrences, unique: this.seen.get(type)?.size ?? 0 };
      total += occurrences;
    }
    return { total, byType };
  }
}

/** Throw if a fresh redaction pass would still change `text`. The message names types, not values. */
export function assertClean(text: string): void {
  const probe = new Redactor();
  probe.redact(text);
  const { total, byType } = probe.report();
  if (total > 0) {
    throw new Error(
      `payload still contains values the redactor would remove (${Object.keys(byType).join(', ')})`,
    );
  }
}
