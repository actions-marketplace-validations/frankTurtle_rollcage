/* eslint-disable @typescript-eslint/no-non-null-assertion -- test data has a known shape */
import { readAuditRecords, sha256Hex, canonicalJson, verifyAuditChain } from '@adl/shared';
import { describe, expect, it } from 'vitest';
import { runWorkflow } from '../src/workflow.js';
import { cleanRun, replies, world } from './helpers.js';

const say = (text: string): string => JSON.stringify({ say: text });

describe('workflow: planner to reviewer', () => {
  it('runs the four agents in order and stops at the approval checkpoint', async () => {
    const { record } = await cleanRun();
    expect(record.status).toBe('awaiting-approval');
    expect(record.handoffs.map((h) => h.agent)).toEqual([
      'planner',
      'implementer',
      'tester',
      'reviewer',
    ]);
    expect(record.handoffs.map((h) => h.decision)).toEqual([
      'proceed',
      'proceed',
      'proceed',
      'approve',
    ]);
    expect(record.reworkRounds).toBe(0);
    expect(record.change?.files['src/greet.ts']).toContain('world');
    expect(record.change?.branch).toBe('develop');
    expect(record.change?.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('repairs a planner reply that breaks the turn format and still finishes', async () => {
    const w = world(['not json', ...replies('clean')]);
    const record = await runWorkflow(w.options);
    expect(record.status).toBe('awaiting-approval');
    expect(record.ledgers['1-planner']?.usage.modelCalls).toBe(2);
  });

  it('records agent, input hash, output, tool calls and decision for every handoff', async () => {
    const { record } = await cleanRun();
    for (const h of record.handoffs) {
      expect(h.inputHash).toMatch(/^[0-9a-f]{64}$/);
      expect(h.output.length).toBeGreaterThan(0);
      expect(h.outputHash).toBe(sha256Hex(h.output));
      expect(record.ledgers[h.ledgerKey]?.finalPhase).toBe('done');
    }
    const impl = record.handoffs[1];
    expect(impl?.toolCalls.map((t) => t.name)).toEqual(['write_file', 'write_file']);
    expect(impl?.toolCalls.every((t) => t.ok && /^[0-9a-f]{64}$/.test(t.argsHash))).toBe(true);
    expect(record.handoffs[2]?.toolCalls.map((t) => t.name)).toEqual(['run_tests']);
  });

  it('writes the same handoffs to the hash-chained audit log', async () => {
    const { w, record } = await cleanRun();
    const audit = readAuditRecords(w.auditPath).filter((r) => r.action === 'handoff');
    expect(audit.map((r) => r.actor)).toEqual([
      'agent:planner',
      'agent:implementer',
      'agent:tester',
      'agent:reviewer',
    ]);
    audit.forEach((r, i) => {
      const h = record.handoffs[i]!;
      expect(r.inputHash).toBe(h.inputHash);
      expect(r.decision).toBe(h.decision);
      expect(r.detail).toMatchObject({
        seq: h.seq,
        outputHash: h.outputHash,
        ledgerDigest: h.ledgerDigest,
      });
    });
    expect(verifyAuditChain(w.auditPath)).toMatchObject({ ok: true });
  });

  it('hashes each agent input, which includes the earlier agent output', async () => {
    const { record } = await cleanRun();
    const goal = record.ledgers[record.handoffs[1]!.ledgerKey]!.goal;
    expect(goal).toContain(record.handoffs[0]!.output);
    expect(record.handoffs[1]!.inputHash).toBe(
      sha256Hex(canonicalJson({ agent: 'implementer', goal })),
    );
  });

  it('produces an identical record when run twice with the same replies', async () => {
    const a = await cleanRun();
    const b = await cleanRun();
    expect(JSON.stringify(a.record)).toBe(JSON.stringify(b.record));
  });

  it('sends review findings back to the implementer and counts the rework', async () => {
    const w = world(replies('rework'));
    const record = await runWorkflow(w.options);
    expect(record.handoffs.map((h) => h.agent)).toEqual([
      'planner',
      'implementer',
      'tester',
      'reviewer',
      'implementer',
      'tester',
      'reviewer',
    ]);
    expect(record.handoffs.map((h) => h.decision)).toEqual([
      'proceed',
      'proceed',
      'proceed',
      'request_changes',
      'proceed',
      'proceed',
      'approve',
    ]);
    expect(record.reworkRounds).toBe(1);
    expect(record.status).toBe('awaiting-approval');
    expect(record.change?.files['src/greet.ts']).toContain('trim');
    const second = record.ledgers[record.handoffs[4]!.ledgerKey]!;
    expect(second.goal).toContain('Whitespace-only names');
  });

  it('halts when rework exceeds the limit, with no change proposed', async () => {
    const w = world(replies('rework'), { maxReworkRounds: 0 });
    const record = await runWorkflow(w.options);
    expect(record.status).toBe('halted');
    expect(record.reason).toMatch(/rework/);
    expect(record.change).toBeUndefined();
  });

  it('treats a reviewer reply that is not a valid verdict as request_changes', async () => {
    const raw = replies('clean');
    raw[raw.length - 1] = say('Looks good to me');
    const record = await runWorkflow(world(raw, { maxReworkRounds: 0 }).options);
    expect(record.handoffs.at(-1)?.decision).toBe('request_changes');
    expect(record.status).toBe('halted');
  });

  it('sends a failing test run back to the implementer', async () => {
    const w = world(replies('clean'), {
      maxReworkRounds: 0,
      runTests: () => ({ passed: false, summary: '1 failed' }),
    });
    const record = await runWorkflow(w.options);
    expect(record.handoffs.at(-1)?.agent).toBe('tester');
    expect(record.handoffs.at(-1)?.decision).toBe('rework');
    expect(record.status).toBe('halted');
  });

  it('does not accept a tester that never ran the tests', async () => {
    const raw = replies('clean');
    raw.splice(5, 2, say('Tests look fine to me'));
    const record = await runWorkflow(world(raw, { maxReworkRounds: 0 }).options);
    expect(record.handoffs.at(-1)?.decision).toBe('rework');
    expect(record.reason).toMatch(/did not run the tests/);
  });

  it('halts when the implementer changes nothing', async () => {
    const raw = replies('clean');
    raw.splice(2, 3, say('Nothing to do'));
    const record = await runWorkflow(world(raw).options);
    expect(record.status).toBe('halted');
    expect(record.reason).toMatch(/no change/);
  });

  it('fails the run when an agent run fails', async () => {
    const record = await runWorkflow(world(['not json', 'still not json']).options);
    expect(record.status).toBe('failed');
    expect(record.handoffs[0]?.decision).toBe('halt');
    expect(record.reason).toMatch(/planner/);
  });
});
