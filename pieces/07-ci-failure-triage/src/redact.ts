/** Known secret shapes. Pattern based, so unusual formats can slip through. */
const PATTERNS: [RegExp, string][] = [
  [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    '[REDACTED:private-key]',
  ],
  [/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, '[REDACTED:aws-key]'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, '[REDACTED:github-token]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '[REDACTED:github-token]'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, '[REDACTED:slack-token]'],
  [/\bsk-[A-Za-z0-9_-]{20,}\b/g, '[REDACTED:api-key]'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g, 'Bearer [REDACTED]'],
  [
    /\b([A-Za-z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|ACCESS_?KEY)[A-Za-z0-9_]*)\s*[=:]\s*\S+/gi,
    '$1=[REDACTED]',
  ],
];

/** Replace known secret shapes with a marker. Applied before any text goes into a prompt or an output file. */
export function redact(text: string): string {
  return PATTERNS.reduce((acc, [re, to]) => acc.replace(re, to), text);
}
