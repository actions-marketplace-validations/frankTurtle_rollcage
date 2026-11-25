/**
 * A made-up incident bundle with planted fake sensitive values, for the demo and the tests.
 * Everything here is fictional. Secret-shaped values are assembled from parts at runtime so that
 * no secret-looking string is stored in the repository (the AWS key is the documented example).
 */
import type { RedactionType } from './redact.js';

export interface Planted {
  type: RedactionType;
  /** The value that must never reach a model or an output file. */
  value: string;
  /** The text planted in the bundle (the value, possibly with its surrounding key). */
  snippet: string;
}

const planted = (type: RedactionType, value: string, snippet = value): Planted => ({
  type,
  value,
  snippet,
});

const PEM_BEGIN = ['-----BEGIN ', 'RSA PRIVATE KEY-----'].join('');
const PEM_END = ['-----END ', 'RSA PRIVATE KEY-----'].join('');
const PEM = `${PEM_BEGIN}\nZmFrZWtleWJvZHkxMjM0NTY3ODkw\nZmFrZWtleWJvZHk5ODc2NTQzMjEw\n${PEM_END}`;
const BEARER = 'fakeBearerTokenValue0123456789';
const JWT = ['eyJ', 'hbGciOiJub25lIn0', '.eyJ', 'zdWIiOiJkZW1vIn0', '.c2lnbmF0dXJl'].join('');
const GITHUB = ['gh', 'p_', 'x1y2z3'.repeat(6)].join('');

export const PLANTED: Planted[] = [
  planted('private-key', PEM),
  planted('bearer-token', BEARER, `Authorization: Bearer ${BEARER}`),
  planted('jwt', JWT),
  planted('github-token', GITHUB),
  planted('aws-access-key', 'AKIAIOSFODNN7EXAMPLE'),
  planted('aws-access-key', ['ASIA', 'IOSFODNN7EXAMPLE'].join('')),
  planted('credential-assignment', 'hunter2hunter2', 'db password=hunter2hunter2'),
  planted('credential-assignment', 'sk_demo_0123456789', '{"api_key":"sk_demo_0123456789"}'),
  planted('email', ['jordan.lee', '@', 'example.com'].join('')),
  planted('credit-card', '4111 1111 1111 1111'),
  planted('credit-card', '5555555555554444'),
  planted('ipv4', '203.0.113.42'),
  planted('ipv6', '2001:db8::8a2e:370:7334'),
  planted('phone', '415-555-0134'),
  planted('phone', '+44 20 7946 0958'),
];

const byType = (type: RedactionType, nth = 0): string =>
  (PLANTED.filter((p) => p.type === type)[nth] as Planted).snippet;

const ms = (iso: string): number => Date.parse(iso);

export function sampleBundleFiles(): Record<string, string> {
  const logs = [
    ['2026-03-04T13:58:10Z', 'WARN db pool wait 4200ms host=10.0.4.17 client=' + byType('ipv4')],
    [
      '2026-03-04T14:01:30Z',
      `ERROR checkout failed: timeout acquiring connection user=${byType('email')}`,
    ],
    ['2026-03-04T14:03:05Z', `ERROR upstream 503 ${byType('bearer-token')}`],
    [
      '2026-03-04T14:05:40Z',
      `INFO config dump ${byType('credential-assignment')} ${byType('aws-access-key')}`,
    ],
    ['2026-03-04T14:06:00Z', `ERROR payment retry ${byType('credit-card')} from ${byType('ipv6')}`],
    ['2026-03-04T14:06:30Z', `DEBUG leaked key\n${byType('private-key')}\nend of dump`],
    ['2026-03-04T14:07:00Z', `WARN session ${JWT} rejected; ${byType('credential-assignment', 1)}`],
    ['2026-03-04T14:40:12Z', 'INFO error rate back to baseline on checkout'],
    // Exported twice by overlapping log queries; the timeline keeps one copy.
    ['2026-03-04T14:40:12Z', 'INFO error rate back to baseline on checkout'],
  ].map(([at, message]) => ({
    timestamp: ms(at as string),
    message,
    logStreamName: 'checkout/app',
  }));

  const chat = [
    ['2026-03-04T14:04:00Z', 'sam.ortiz', 'Paged. Checkout error rate is at 31 percent.'],
    ['2026-03-04T14:06:00Z', 'dana.reyes', 'dana.reyes here. I shipped 2.14.0 at 13:48, checking.'],
    [
      '2026-03-04T14:10:00Z',
      'sam.ortiz',
      `Support got a call from ${byType('phone')} and ${byType('phone', 1)}, card ${byType('credit-card', 1)}.`,
    ],
    [
      '2026-03-04T14:12:00Z',
      'dana.reyes',
      `Mail from ${byType('email')} says orders hang. Rolling back.`,
    ],
    ['1772633400', 'sam.ortiz', 'Rollback of checkout is running.'],
    ['2026-03-04T14:41:00-00:00', 'sam.ortiz', 'Dashboards look normal again.'],
  ].map(([ts, user, text]) => ({ ts, user, text }));

  const notes = [
    '# Incident notes',
    '',
    `- 14:22 UTC Rollback finished. Someone pasted ${byType('github-token')} in the channel, rotate it.`,
    `- 14:50 UTC Customer data check: nothing else found. Contact ${byType('email')} for follow-up.`,
    '- 15:47 UTC Incident closed.',
  ].join('\n');

  const deploys = [
    { at: '2026-03-04T13:48:00Z', service: 'checkout', version: 'v2.14.0', deployer: 'dana.reyes' },
    {
      at: '2026-03-04T14:21:00Z',
      service: 'checkout',
      version: 'v2.13.9',
      deployer: 'sam.ortiz',
      status: 'rollback',
    },
  ];

  return {
    'incident.json': JSON.stringify({
      id: 'INC-204',
      title: 'Checkout latency and errors',
      severity: 'SEV2',
      opened_at: '2026-03-04T14:02:00Z',
      closed_at: '2026-03-04T15:47:00Z',
    }),
    'logs.json': JSON.stringify({ events: logs }),
    'chat.json': JSON.stringify(chat),
    'notes.md': notes,
    'deploys.json': JSON.stringify(deploys),
  };
}
