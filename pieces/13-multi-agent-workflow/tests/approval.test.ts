/* eslint-disable @typescript-eslint/no-non-null-assertion -- test data has a known shape */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { readAuditRecords } from '@adl/shared';
import { describe, expect, it } from 'vitest';
import { ApprovalGate, DryRunCommitter, hashChange, type ProposedChange } from '../src/approval.js';
import { FIXED_NOW, cleanRun } from './helpers.js';

const AGENT_NAMES = ['planner', 'implementer', 'tester', 'reviewer'];

async function setup(branch = 'develop') {
  const { w, record } = await cleanRun();
  const change: ProposedChange = { ...record.change!, branch };
  change.hash = hashChange(change);
  const gate = new ApprovalGate({
    auditPath: w.auditPath,
    agentBranches: ['agent/*'],
    agentNames: AGENT_NAMES,
    now: FIXED_NOW,
  });
  return { w, change, gate, committer: new DryRunCommitter() };
}

describe('approval checkpoint', () => {
  it('blocks a commit to a shared branch when nobody approved, and never calls the committer', async () => {
    const { w, change, gate, committer } = await setup();
    const res = await gate.commit(change, committer);
    expect(res).toMatchObject({ committed: false });
    expect(res.reason).toMatch(/no approval/);
    expect(committer.commits).toEqual([]);
    const last = readAuditRecords(w.auditPath).at(-1)!;
    expect(last).toMatchObject({ action: 'commit', decision: 'blocked' });
  });

  it('commits after a named human approves that exact change', async () => {
    const { w, change, gate, committer } = await setup();
    gate.approve(change, 'alice');
    const res = await gate.commit(change, committer);
    expect(res.committed).toBe(true);
    expect(committer.commits).toHaveLength(1);
    expect(committer.commits[0]).toMatchObject({ branch: 'develop', hash: change.hash });
    const log = readAuditRecords(w.auditPath);
    expect(log.find((r) => r.action === 'approve')).toMatchObject({ actor: 'human:alice' });
    expect(log.at(-1)).toMatchObject({ action: 'commit', decision: 'committed' });
  });

  it('does not let an agent approve', async () => {
    const { change, gate, committer } = await setup();
    expect(() => gate.approve(change, 'agent:reviewer')).toThrow(/agent/);
    expect(() => gate.approve(change, 'reviewer')).toThrow(/agent/);
    expect(() => gate.approve(change, '  ')).toThrow(/approver/);
    expect((await gate.commit(change, committer)).committed).toBe(false);
  });

  it('ties the approval to the change: an edited change is not approved', async () => {
    const { change, gate, committer } = await setup();
    gate.approve(change, 'alice');
    const edited: ProposedChange = {
      ...change,
      files: { ...change.files, 'src/greet.ts': 'evil()' },
    };
    edited.hash = hashChange(edited);
    const res = await gate.commit(edited, committer);
    expect(res.committed).toBe(false);
    expect(committer.commits).toEqual([]);
  });

  it('rejects a change whose stored hash does not match its content', async () => {
    const { change, gate, committer } = await setup();
    gate.approve(change, 'alice');
    const forged = { ...change, files: { 'src/greet.ts': 'evil()' } };
    const res = await gate.commit(forged, committer);
    expect(res.committed).toBe(false);
    expect(res.reason).toMatch(/hash/);
  });

  it('does not honor approvals when the audit chain is broken', async () => {
    const { w, change, gate, committer } = await setup();
    gate.approve(change, 'alice');
    const lines = readFileSync(w.auditPath, 'utf8').split('\n').filter(Boolean);
    lines[0] = lines[0]!.replace('"handoff"', '"handoff2"');
    writeFileSync(w.auditPath, `${lines.join('\n')}\n`);
    const res = await gate.commit(change, committer);
    expect(res.committed).toBe(false);
    expect(res.reason).toMatch(/audit chain/);
  });

  it('ignores an approval line that an agent appended by hand', async () => {
    const { w, change, gate, committer } = await setup();
    appendFileSync(
      w.auditPath,
      `${JSON.stringify({ actor: 'agent:implementer', action: 'approve', detail: { changeHash: change.hash }, prevHash: 'x' })}\n`,
    );
    expect((await gate.commit(change, committer)).committed).toBe(false);
  });

  it('lets a commit to an agent branch through without approval, and logs it', async () => {
    const { w, change, gate, committer } = await setup('agent/greet');
    const res = await gate.commit(change, committer);
    expect(res.committed).toBe(true);
    expect(readAuditRecords(w.auditPath).at(-1)).toMatchObject({
      action: 'commit',
      decision: 'committed',
    });
  });

  it('treats any branch that is not an agent branch as shared', async () => {
    for (const branch of ['main', 'develop', 'release/1.0', 'feature/x', 'agentx/y']) {
      const { change, gate, committer } = await setup(branch);
      expect((await gate.commit(change, committer)).committed).toBe(false);
    }
  });
});
