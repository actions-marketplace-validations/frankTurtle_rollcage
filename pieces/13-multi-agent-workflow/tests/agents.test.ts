import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadRoleAgents, parseAgentFile } from '../src/agents.js';
import { ROLES } from '../src/roles.js';
import { buildToolRegistry } from '../src/tools.js';
import { markerTestRunner, Workspace } from '../src/workspace.js';
import { AGENTS_DIR, PIECE } from './helpers.js';

const agents = loadRoleAgents(AGENTS_DIR);
const ctx = (ws = Workspace.fromFiles({ 'a.txt': 'alpha' })) => ({
  workspace: ws,
  runTests: markerTestRunner,
});
const call = (name: string, args: Record<string, string> = {}) => ({ id: 'c1', name, args });
const toolCtx = { runId: 'r', stepId: 's', clock: { now: () => 0, sleep: async () => {} } };

describe('agent files', () => {
  it('has the four roles with valid frontmatter', () => {
    expect(ROLES).toEqual(['planner', 'implementer', 'tester', 'reviewer']);
    for (const role of ROLES) {
      expect(agents[role].name).toBe(role);
      expect(agents[role].description.length).toBeGreaterThan(10);
      expect(agents[role].prompt).toContain(`You are the ${role}`);
    }
  });

  it('keeps .claude/agents identical to the canonical copies', () => {
    const canonical = readdirSync(AGENTS_DIR).sort();
    const installed = readdirSync(join(PIECE, '..', '..', '.claude', 'agents')).sort();
    expect(installed).toEqual(canonical);
    for (const file of canonical) {
      expect(readFileSync(join(PIECE, '..', '..', '.claude', 'agents', file), 'utf8')).toBe(
        readFileSync(join(AGENTS_DIR, file), 'utf8'),
      );
    }
  });

  it('maps frontmatter tools to the least privilege each role needs', () => {
    expect(agents.reviewer.orchestratorTools).not.toContain('write_file');
    expect(agents.reviewer.orchestratorTools).not.toContain('run_tests');
    expect(agents.planner.orchestratorTools).not.toContain('write_file');
    expect(agents.implementer.orchestratorTools).toContain('write_file');
    expect(agents.tester.orchestratorTools).toContain('run_tests');
    for (const role of ROLES) {
      expect(agents[role].orchestratorTools.some((t) => /commit|push|shell/.test(t))).toBe(false);
    }
  });

  it('rejects malformed files and unknown tools', () => {
    expect(() => parseAgentFile('no frontmatter', 'x.md')).toThrow(/frontmatter/);
    expect(() => parseAgentFile('---\ndescription: d\n---\nbody', 'x.md')).toThrow(/name/);
    expect(() =>
      parseAgentFile('---\nname: a\ndescription: d\ntools: Read, Teleport\n---\nb', 'x.md'),
    ).toThrow(/Teleport/);
    expect(() => parseAgentFile('---\nname: a\ndescription: d\n---\n', 'x.md')).toThrow(/body/);
  });

  it('accepts a YAML list of tools and rejects a missing role', () => {
    const a = parseAgentFile(
      '---\nname: a\ndescription: d\ntools:\n  - Read\n  - Glob\n---\nYou are a.',
      'x.md',
    );
    expect(a.orchestratorTools).toEqual(['list_files', 'read_file', 'search_files']);
    expect(() => loadRoleAgents(join(PIECE, 'fixtures'))).toThrow(/planner/);
  });
});

describe('tool registry', () => {
  it('only exposes the tools the agent is allowed', () => {
    const reviewer = buildToolRegistry(agents.reviewer, ctx());
    expect(reviewer.has('write_file')).toBe(false);
    expect(reviewer.has('read_file')).toBe(true);
    expect(buildToolRegistry(agents.implementer, ctx()).has('write_file')).toBe(true);
  });

  it('rejects a call to a tool the agent does not have, and leaves the workspace alone', async () => {
    const ws = Workspace.fromFiles({});
    const reg = buildToolRegistry(agents.planner, ctx(ws));
    const res = await reg.invoke(call('write_file', { path: 'x.ts', content: 'x' }), toolCtx);
    expect(res.ok).toBe(false);
    expect(ws.changes()).toEqual({});
  });

  it('reads, lists, searches and writes through the workspace', async () => {
    const ws = Workspace.fromFiles({ 'a.txt': 'alpha', 'd/b.txt': 'beta alpha' });
    const reg = buildToolRegistry(agents.implementer, ctx(ws));
    expect(await reg.invoke(call('read_file', { path: 'a.txt' }), toolCtx)).toEqual({
      ok: true,
      value: 'alpha',
    });
    expect(await reg.invoke(call('list_files'), toolCtx)).toEqual({
      ok: true,
      value: ['a.txt', 'd/b.txt'],
    });
    expect(await reg.invoke(call('search_files', { query: 'beta' }), toolCtx)).toEqual({
      ok: true,
      value: ['d/b.txt'],
    });
    await reg.invoke(call('write_file', { path: 'n.ts', content: 'new' }), toolCtx);
    expect(ws.changes()).toEqual({ 'n.ts': 'new' });
  });

  it('refuses paths outside the workspace and missing files', async () => {
    const reg = buildToolRegistry(agents.implementer, ctx());
    for (const path of ['../x', '/etc/passwd', 'a/../../b']) {
      const res = await reg.invoke(call('write_file', { path, content: 'x' }), toolCtx);
      expect(res.ok).toBe(false);
    }
    const missing = await reg.invoke(call('read_file', { path: 'nope.txt' }), toolCtx);
    expect(missing.ok).toBe(false);
  });

  it('runs the injected test runner and reports its result', async () => {
    const ws = Workspace.fromFiles({ 'a.ts': 'FIXME' });
    const reg = buildToolRegistry(agents.tester, ctx(ws));
    const res = await reg.invoke(call('run_tests'), toolCtx);
    expect(res).toMatchObject({ ok: true, value: { passed: false } });
  });
});
