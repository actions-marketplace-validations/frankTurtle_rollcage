/* eslint-disable @typescript-eslint/no-non-null-assertion -- test data has a known shape */
import { describe, expect, it } from 'vitest';
import { parseRecord, serializeRecord } from '../src/workflow.js';
import { replayRecord } from '../src/replay.js';
import { markerTestRunner } from '../src/workspace.js';
import { cleanRun, freshWorkspace, replies, world } from './helpers.js';
import { runWorkflow } from '../src/workflow.js';

const deps = (w: Awaited<ReturnType<typeof cleanRun>>['w']) => ({
  agents: w.options.agents,
  workspace: freshWorkspace(),
  runTests: markerTestRunner,
});

describe('replay', () => {
  it('replays a recorded run exactly: reducer, handoffs and re-execution', async () => {
    const { w, record } = await cleanRun();
    const result = await replayRecord(record, deps(w));
    expect(result).toMatchObject({
      ok: true,
      ledgersOk: true,
      handoffMismatches: [],
      reexecutionIdentical: true,
    });
  });

  it('replays after the record has been written to disk and read back', async () => {
    const { w, record } = await cleanRun();
    const result = await replayRecord(parseRecord(serializeRecord(record)), deps(w));
    expect(result.ok).toBe(true);
  });

  it('replays a run that went through a rework round', async () => {
    const w = world(replies('rework'));
    const record = await runWorkflow(w.options);
    expect((await replayRecord(record, deps(w))).ok).toBe(true);
  });

  it('detects a ledger edited after the fact', async () => {
    const { w, record } = await cleanRun();
    const copy = parseRecord(serializeRecord(record));
    const ledger = copy.ledgers[copy.handoffs[1]!.ledgerKey]!;
    const entry = ledger.entries.find((e) => e.event.type === 'tools.completed')!;
    (entry.event as unknown as { results: { content: string }[] }).results[0]!.content = 'edited';
    const result = await replayRecord(copy, deps(w));
    expect(result.ok).toBe(false);
    expect(result.handoffMismatches.map((m) => m.seq)).toContain(2);
  });

  it('detects a ledger whose transitions no longer reproduce', async () => {
    const { w, record } = await cleanRun();
    const copy = parseRecord(serializeRecord(record));
    const entries = copy.ledgers[copy.handoffs[0]!.ledgerKey]!.entries;
    (entries[2] as { to: string }).to = 'done';
    const result = await replayRecord(copy, deps(w));
    expect(result.ledgersOk).toBe(false);
    expect(result.ok).toBe(false);
  });

  it('detects an edited handoff output', async () => {
    const { w, record } = await cleanRun();
    const copy = parseRecord(serializeRecord(record));
    copy.handoffs[3]!.output = '{"verdict":"approve","findings":[],"assumptions":[]}';
    const result = await replayRecord(copy, deps(w));
    expect(result.ok).toBe(false);
    expect(result.handoffMismatches.map((m) => m.seq)).toContain(4);
  });

  it('links each ledger to the run before it', async () => {
    const { record } = await cleanRun();
    const parents = record.handoffs.map((h) => record.ledgers[h.ledgerKey]?.parentRunId ?? null);
    expect(parents).toEqual([
      null,
      'run-test-1-planner',
      'run-test-2-implementer',
      'run-test-3-tester',
    ]);
  });

  it('detects handoffs reordered after the fact', async () => {
    const { w, record } = await cleanRun();
    const copy = parseRecord(serializeRecord(record));
    const [a, b] = [copy.handoffs[1]!, copy.handoffs[2]!];
    [a.ledgerKey, b.ledgerKey] = [b.ledgerKey, a.ledgerKey];
    const result = await replayRecord(copy, deps(w));
    expect(result.ok).toBe(false);
    expect(result.handoffMismatches.some((m) => /parent/.test(m.what))).toBe(true);
  });

  it('rejects a record from an unknown version', () => {
    expect(() => parseRecord('{"version":99}')).toThrow(/version/);
  });
});
