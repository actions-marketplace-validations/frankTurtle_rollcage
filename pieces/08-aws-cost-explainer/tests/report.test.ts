import { FakeLlm } from '@adl/shared';
import { describe, expect, it } from 'vitest';
import { fixtureCostPort } from '../src/adapters.ts';
import { FIXTURE_CONFIG, FIXTURE_NOW } from '../src/fixture-data.ts';
import { runReport } from '../src/report.ts';
import { fakeChannel, GOOD_REPLY, must } from './helpers.ts';

const base = { now: FIXTURE_NOW, config: FIXTURE_CONFIG, cost: fixtureCostPort() };

describe('AC-9 notifications go to every configured channel', () => {
  it('sends the same message to each channel, with the computed numbers beside the summary', async () => {
    const email = fakeChannel('sns');
    const slack = fakeChannel('slack');
    const r = await runReport({
      ...base,
      llm: new FakeLlm([GOOD_REPLY]),
      channels: [email, slack],
    });
    expect(email.sent).toEqual(slack.sent);
    const [subject, text] = must(email.sent[0]);
    expect(subject).toContain('AWS cost report');
    expect(subject).toContain('2026-11-16');
    expect(text).toContain('Assumptions');
    expect(text).toContain('Amazon OpenSearch Service');
    expect(text).toContain('(untagged)');
    expect(text).toContain('Time to notice');
    expect(text).toContain('Unexplained spend: $580');
    expect(text).toContain('written by the model');
    expect(r.deliveries).toEqual([
      { channel: 'sns', ok: true },
      { channel: 'slack', ok: true },
    ]);
  });

  it('says plainly when the deterministic summary was used, and why', async () => {
    const email = fakeChannel('sns');
    const r = await runReport({ ...base, llm: new FakeLlm(['bad', 'bad']), channels: [email] });
    expect(r.summary.source).toBe('fallback');
    expect(must(email.sent[0])[1]).toContain('Deterministic summary');
    expect(must(email.sent[0])[1]).toContain(r.summary.reason);
  });

  it('keeps going when one channel fails', async () => {
    const email = fakeChannel('sns');
    const slack = fakeChannel('slack', 'webhook returned 500');
    const r = await runReport({ ...base, channels: [slack, email] });
    expect(email.sent).toHaveLength(1);
    expect(r.deliveries).toEqual([
      { channel: 'slack', ok: false, error: 'webhook returned 500' },
      { channel: 'sns', ok: true },
    ]);
  });

  it('fails the run when every channel fails', async () => {
    const channels = [fakeChannel('sns', 'a'), fakeChannel('slack', 'b')];
    await expect(runReport({ ...base, channels })).rejects.toThrow(/all notifications failed/);
  });

  it('computes without sending when there are no channels', async () => {
    const r = await runReport({ ...base, channels: [] });
    expect(r.deliveries).toEqual([]);
    expect(r.analysis.unexplained.amount).toBe(580);
  });
});
