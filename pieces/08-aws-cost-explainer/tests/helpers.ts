import type { NotifyPort } from '../src/types.ts';

/** A channel that records what it was asked to send, or fails on demand. */
export function fakeChannel(name: string, failWith?: string): NotifyPort & { sent: string[][] } {
  const sent: string[][] = [];
  return {
    name,
    sent,
    async send(subject, text) {
      if (failWith) throw new Error(failWith);
      sent.push([subject, text]);
    },
  };
}

/** A model reply that only quotes figures from the fixture week. */
export const GOOD_REPLY = JSON.stringify({
  headline: 'Spend rose $711 week over week; $580 of it is unexplained.',
  paragraphs: [
    'Amazon OpenSearch Service is new this week at $310 and EC2 - Other (NAT gateway traffic) rose by $270.',
    'Both match Cost Anomaly Detection findings.',
  ],
  assumptions: ['The OpenSearch domain was created on purpose; the data does not say.'],
});

/** Narrow a possibly missing value, failing the test with a clear message instead of using `!`. */
export function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value');
  return value;
}
