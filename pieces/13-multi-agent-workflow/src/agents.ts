import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { ROLES, type Role } from './roles.js';

/** Claude Code tool names an agent file may list, and the orchestrator tools each one grants. */
export const TOOL_MAP: Readonly<Record<string, readonly string[]>> = {
  Read: ['read_file'],
  Grep: ['search_files'],
  Glob: ['list_files'],
  Write: ['write_file'],
  Edit: ['write_file'],
  // Bash maps to the test runner only. It is never a shell.
  Bash: ['run_tests'],
};

const Frontmatter = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  tools: z.union([z.string(), z.array(z.string())]).optional(),
  model: z.string().optional(),
});

export interface AgentDef {
  name: string;
  description: string;
  /** Tool names as written in the frontmatter. */
  tools: string[];
  /** Orchestrator tools those names grant, sorted. No `tools` line means no tools. */
  orchestratorTools: string[];
  model?: string;
  /** The Markdown body: the agent's system prompt. */
  prompt: string;
}

/**
 * Parse a Claude Code subagent file: YAML frontmatter on the first line, Markdown body after it.
 * Unlike Claude Code, a missing `tools` line grants nothing instead of everything.
 */
export function parseAgentFile(text: string, source = 'agent file'): AgentDef {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match)
    throw new Error(`${source}: frontmatter must start on the first line, between --- lines`);
  const parsed = Frontmatter.safeParse(parse(match[1] as string));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`${source}: frontmatter field ${issue?.path.join('.')}: ${issue?.message}`);
  }
  const prompt = (match[2] as string).trim();
  if (!prompt) throw new Error(`${source}: the body (the system prompt) is empty`);

  const raw = parsed.data.tools ?? [];
  const tools = (Array.isArray(raw) ? raw : raw.split(',')).map((t) => t.trim()).filter(Boolean);
  const granted = new Set<string>();
  for (const tool of tools) {
    const mapped = TOOL_MAP[tool];
    if (!mapped) {
      throw new Error(
        `${source}: unknown tool "${tool}". Known: ${Object.keys(TOOL_MAP).join(', ')}`,
      );
    }
    mapped.forEach((t) => granted.add(t));
  }
  return {
    name: parsed.data.name,
    description: parsed.data.description,
    tools,
    orchestratorTools: [...granted].sort(),
    ...(parsed.data.model ? { model: parsed.data.model } : {}),
    prompt,
  };
}

export function loadRoleAgents(dir: string): Record<Role, AgentDef> {
  const entries = ROLES.map((role) => {
    const file = join(dir, `${role}.md`);
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      throw new Error(`agent file for ${role} not found at ${file}`);
    }
    const agent = parseAgentFile(text, file);
    if (agent.name !== role)
      throw new Error(`${file}: name must be "${role}", got "${agent.name}"`);
    return [role, agent] as const;
  });
  return Object.fromEntries(entries) as Record<Role, AgentDef>;
}
