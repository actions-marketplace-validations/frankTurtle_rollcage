import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AuditLogger, readAuditRecords } from '@adl/shared';
import { gate, neverCalls, runSuite, toBaseline, type Baseline } from 'escapement';
import { describe, expect, it } from 'vitest';
import { buildEvalSuite } from '../src/eval-cases.js';
import { computeMetrics, traceComplete } from '../src/metrics.js';
import { runWorkflow } from '../src/workflow.js';
import { FIXED_NOW, PIECE, cleanRun, replies, tmp, world } from './helpers.js';

describe('metrics', () => {
  it('reports complete traces and rework rate over a set of runs', async () => {
    const dir = tmp();
    const audit = new AuditLogger(join(dir, 'audit.jsonl'), FIXED_NOW);
    const a = await runWorkflow(world(replies('clean'), { audit }, 'a').options);
    const b = await runWorkflow(world(replies('rework'), { audit }, 'b').options);
    const m = computeMetrics([a, b], readAuditRecords(join(dir, 'audit.jsonl')));
    expect(m).toMatchObject({
      runs: 2,
      withChange: 2,
      completeTrace: 2,
      completeTracePct: 100,
      reviewed: 2,
      reworked: 1,
      reworkRatePct: 50,
    });
  });

  it('flags a trace with no audit entries and says what is missing', async () => {
    const { record } = await cleanRun();
    const check = traceComplete(record, []);
    expect(check.complete).toBe(false);
    expect(check.missing).toContain('audit entry for handoff 1');
    expect(computeMetrics([record], []).completeTracePct).toBe(0);
  });

  it('flags a trace missing a role', async () => {
    const { w, record } = await cleanRun();
    const trimmed = { ...record, handoffs: record.handoffs.filter((h) => h.agent !== 'tester') };
    const check = traceComplete(trimmed, readAuditRecords(w.auditPath));
    expect(check.complete).toBe(false);
    expect(check.missing).toContain('handoff for tester');
  });

  it('does not count runs that proposed no change, and handles an empty set', async () => {
    const halted = await runWorkflow(world(replies('rework'), { maxReworkRounds: 0 }).options);
    const m = computeMetrics([halted], []);
    expect(m.withChange).toBe(0);
    expect(m.completeTracePct).toBe(0);
    expect(m.reviewed).toBe(1);
    expect(m.reworkRatePct).toBe(100);
    expect(computeMetrics([], [])).toMatchObject({
      runs: 0,
      completeTracePct: 0,
      reworkRatePct: 0,
    });
  });
});

describe('trajectory evals', () => {
  it('grades each agent run from the recorded turns and all cases pass', async () => {
    const { w, record } = await cleanRun();
    const suite = buildEvalSuite(record, w.options.agents);
    expect(suite.cases.map((c) => c.id)).toEqual([
      '1-planner',
      '2-implementer',
      '3-tester',
      '4-reviewer',
    ]);
    const result = await runSuite(suite);
    expect(result.failed).toBe(0);
    expect(result.score).toBe(1);
  });

  it('matches the committed baseline', async () => {
    const { w, record } = await cleanRun();
    const result = await runSuite(buildEvalSuite(record, w.options.agents));
    const baseline = JSON.parse(
      readFileSync(join(PIECE, 'evals', 'baseline.json'), 'utf8'),
    ) as Baseline;
    const verdict = gate(result, baseline);
    expect(verdict.findings.filter((f) => f.severity === 'error')).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  it('fails the gate when an agent changes behavior', async () => {
    const { w, record } = await cleanRun();
    const suite = buildEvalSuite(record, w.options.agents);
    const baseline = toBaseline(await runSuite(suite));
    const degraded = {
      ...suite,
      cases: suite.cases.map((c) =>
        c.id === '2-implementer' ? { ...c, graders: [...c.graders, neverCalls('write_file')] } : c,
      ),
    };
    const verdict = gate(await runSuite(degraded), baseline);
    expect(verdict.ok).toBe(false);
    expect(
      verdict.findings.some((f) => f.kind === 'regression' && f.caseId === '2-implementer'),
    ).toBe(true);
  });

  it('fails the gate when an agent starts using a different trajectory budget', async () => {
    const { w, record } = await cleanRun();
    const baseline = toBaseline(await runSuite(buildEvalSuite(record, w.options.agents)));
    const tighter = buildEvalSuite(record, w.options.agents, { maxSteps: 1 });
    const verdict = gate(await runSuite(tighter), baseline);
    expect(verdict.ok).toBe(false);
  });
});
