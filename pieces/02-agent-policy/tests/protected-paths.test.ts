import { describe, expect, it } from 'vitest';
import { loadPolicyConfig } from '../src/config.ts';
import { evaluate } from '../src/guard.ts';
import type { GuardContext } from '../src/guard.ts';

const ctxFor = (yaml?: string): GuardContext => ({
  projectDir: '/repo',
  home: '/home/dev',
  config: loadPolicyConfig(yaml),
});
const ctx = ctxFor();

const bash = (command: string, c = ctx, cwd = '/repo') =>
  evaluate({ tool_name: 'Bash', tool_input: { command }, cwd }, c);
const tool = (tool_name: string, tool_input: Record<string, unknown>, c = ctx, cwd = '/repo') =>
  evaluate({ tool_name, tool_input, cwd }, c);

const expectDenied = (commands: string[], c = ctx) => {
  for (const cmd of commands) {
    expect(bash(cmd, c), cmd).toMatchObject({ allow: false, rule: 'protected-path' });
  }
};
const expectAllowed = (commands: string[], c = ctx) => {
  for (const cmd of commands) expect(bash(cmd, c), cmd).toEqual({ allow: true });
};

const PROTECTED = [
  '.claude/settings.json',
  '.claude/settings.local.json',
  '.claude/agent-policy.yml',
  'pieces/02-agent-policy/src/guard.ts',
  'pieces/02-agent-policy/src/nested/x.ts',
];

describe('protected paths: the guard cannot edit itself', () => {
  it('defaults to the settings, the policy config and the hook source', () => {
    expect(loadPolicyConfig().protected_paths).toEqual([
      '.claude/settings.json',
      '.claude/settings.local.json',
      '.claude/agent-policy.yml',
      'pieces/02-agent-policy/src/**',
    ]);
  });

  it('denies Write, Edit, MultiEdit and NotebookEdit on protected files', () => {
    for (const p of PROTECTED) {
      for (const name of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']) {
        const key = name === 'NotebookEdit' ? 'notebook_path' : 'file_path';
        for (const path of [p, `/repo/${p}`, `./${p}`, `/repo/src/../${p}`]) {
          const d = tool(name, { [key]: path });
          expect(d, `${name} ${path}`).toMatchObject({ allow: false, rule: 'protected-path' });
          expect(d.target).toBe(`/repo/${p}`);
        }
      }
    }
  });

  it('resolves relative paths against the call cwd', () => {
    expect(tool('Write', { file_path: 'settings.json' }, ctx, '/repo/.claude').rule).toBe(
      'protected-path',
    );
    expect(tool('Write', { file_path: 'settings.json' }, ctx, '/repo').allow).toBe(true);
  });

  it('denies shell writes aimed at protected files', () => {
    expectDenied([
      'echo x > .claude/settings.json',
      'echo x >> .claude/agent-policy.yml',
      'echo x >| .claude/settings.local.json',
      'cat a > pieces/02-agent-policy/src/guard.ts',
      "sed -i 's/block/allow/' .claude/settings.json",
      "sed -i '' 's/a/b/' pieces/02-agent-policy/src/hook.ts",
      "sed -i.bak -e 's/a/b/' .claude/agent-policy.yml",
      'tee .claude/settings.json < /tmp/x',
      'echo x | tee -a .claude/agent-policy.yml',
      'cp /tmp/evil.yml .claude/agent-policy.yml',
      'cp -f /tmp/evil.ts pieces/02-agent-policy/src/guard.ts',
      'mv /tmp/evil.json .claude/settings.json',
      'mv .claude/settings.json /tmp/s.json',
      'rm .claude/settings.local.json',
      'rm -f pieces/02-agent-policy/src/guard.ts',
      'touch .claude/settings.json',
      'truncate -s 0 .claude/agent-policy.yml',
      'dd if=/tmp/x of=.claude/settings.json',
      'sh -c "echo x > .claude/settings.json"',
      'cd .claude && echo x > settings.json',
      'cd .claude && rm settings.json',
      'sudo rm .claude/agent-policy.yml',
      'find .claude -name settings.json -exec rm {} \\;',
    ]);
  });

  it('denies removing or moving a directory that holds protected files', () => {
    expectDenied([
      'rm -rf .claude',
      'rm -rf pieces/02-agent-policy/src',
      'rm -rf pieces',
      'rm -rf /repo',
      'mv .claude /tmp/claude-old',
      'rmdir .claude',
    ]);
  });

  it('allows reading protected files', () => {
    expectAllowed([
      'cat .claude/settings.json',
      'cat .claude/agent-policy.yml',
      'grep -n hook .claude/settings.json',
      'sed -n 1,5p .claude/settings.json',
      'sed "s/a/b/" .claude/settings.json',
      'cp .claude/settings.json /tmp/settings.copy',
      'cp pieces/02-agent-policy/src/guard.ts /tmp/guard.ts',
      'ls .claude pieces/02-agent-policy/src',
      'diff .claude/settings.json /tmp/x',
      'node pieces/02-agent-policy/src/bin.ts selftest',
    ]);
    for (const p of PROTECTED) {
      for (const name of ['Read', 'Grep']) {
        expect(tool(name, { file_path: `/repo/${p}` }).allow, `${name} ${p}`).toBe(true);
      }
    }
    expect(tool('Glob', { path: '/repo/.claude', pattern: '*.json' }).allow).toBe(true);
  });

  it('allows writes to neighbours of protected files', () => {
    expectAllowed([
      'echo x > .claude/audit/agent.audit.jsonl',
      'echo x > .claude/notes.md',
      'echo x > pieces/02-agent-policy/README.md',
      'echo x > pieces/02-agent-policy/tests/new.test.ts',
      'mkdir -p .claude',
      'cp /tmp/a .claude/',
      'rm -rf node_modules',
      'rm -rf pieces/02-agent-policy/demo/out',
    ]);
    expect(tool('Write', { file_path: '/repo/.claude/commands/x.md' }).allow).toBe(true);
    expect(tool('Edit', { file_path: '/repo/pieces/03-x/src/a.ts' }).allow).toBe(true);
    expect(tool('Edit', { file_path: '/repo/other/.claude/settings.json' }).allow).toBe(true);
  });

  it('does not treat the user-level ~/.claude/settings.json as a project file', () => {
    expect(tool('Write', { file_path: '~/.claude/settings.json' }).allow).toBe(true);
  });

  it('leaves a variable redirect target to the write-outside-repo rule', () => {
    expect(bash('echo x > $HOME/.claude/settings.json').rule).toBe('write-outside-repo');
  });

  it('uses the configured list instead of the defaults', () => {
    const c = ctxFor('protected_paths:\n  - Makefile\n  - ci/**\n');
    expect(tool('Write', { file_path: '/repo/Makefile' }, c).rule).toBe('protected-path');
    expect(tool('Write', { file_path: '/repo/ci/deploy/x.yml' }, c).rule).toBe('protected-path');
    expectDenied(['echo x > ci/a.yml'], c);
    expect(tool('Write', { file_path: '/repo/.claude/settings.json' }, c).allow).toBe(true);
  });

  it('matches a bare file name anywhere and honours ~ and absolute entries', () => {
    const c = ctxFor('protected_paths:\n  - CODEOWNERS\n  - ~/.zshrc-guard\n  - /opt/guard/**\n');
    expect(tool('Write', { file_path: '/repo/.github/CODEOWNERS' }, c).rule).toBe('protected-path');
    expect(tool('Write', { file_path: '/home/dev/.zshrc-guard' }, c).rule).toBe('protected-path');
    expect(tool('Write', { file_path: '/repo/x.ts' }, c).allow).toBe(true);
    const abs = ctxFor('allow_write_dirs: ["/opt"]\nprotected_paths:\n  - /opt/guard/**\n');
    expect(tool('Write', { file_path: '/opt/guard/a' }, abs).rule).toBe('protected-path');
    expect(tool('Write', { file_path: '/opt/other/a' }, abs).allow).toBe(true);
  });

  it('can be switched off with an empty list', () => {
    const c = ctxFor('protected_paths: []\n');
    expect(tool('Write', { file_path: '/repo/.claude/settings.json' }, c).allow).toBe(true);
    expectAllowed(['echo x > .claude/settings.json', 'rm -rf .claude'], c);
  });

  it('tells the agent to ask a human to edit the file themselves', () => {
    const d = tool('Edit', { file_path: '/repo/.claude/settings.json' });
    expect(d.reason).toMatch(/human/i);
    expect(d.reason).toMatch(/themselves/);
  });
});
