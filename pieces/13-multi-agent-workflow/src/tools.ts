import {
  correctable,
  createRegistry,
  defineTool,
  err,
  ok,
  type JsonValue,
  type ObjectSchema,
  type ToolDefinition,
  type ToolRegistry,
} from 'escapement';
import type { AgentDef } from './agents.js';
import type { TestRunner, Workspace } from './workspace.js';

export interface ToolDeps {
  workspace: Workspace;
  runTests: TestRunner;
}

const str = (description: string) => ({ type: 'string' as const, description });
const empty = { type: 'object', properties: {} } as const satisfies ObjectSchema;
const pathSchema = {
  type: 'object',
  properties: { path: str('Repository-relative path') },
  required: ['path'],
} as const satisfies ObjectSchema;

/** Run a workspace operation and turn a thrown message into an observation the model can correct. */
function guarded(fn: () => JsonValue) {
  try {
    return ok(fn());
  } catch (e) {
    return err(correctable('tool.rejected', e instanceof Error ? e.message : String(e)));
  }
}

function allTools({ workspace, runTests }: ToolDeps): Record<string, ToolDefinition> {
  return {
    read_file: defineTool({
      name: 'read_file',
      description: 'Read one file.',
      schema: pathSchema,
      handler: (a) => guarded(() => workspace.read(a.path)),
      readOnly: true,
    }),
    list_files: defineTool({
      name: 'list_files',
      description: 'List every file path.',
      schema: empty,
      handler: () => guarded(() => workspace.list()),
      readOnly: true,
    }),
    search_files: defineTool({
      name: 'search_files',
      description: 'List files whose content contains the query text.',
      schema: { type: 'object', properties: { query: str('Text to find') }, required: ['query'] },
      handler: (a) => guarded(() => workspace.search(a.query)),
      readOnly: true,
    }),
    write_file: defineTool({
      name: 'write_file',
      description: 'Create or replace one file.',
      schema: {
        type: 'object',
        properties: { path: str('Repository-relative path'), content: str('Full new content') },
        required: ['path', 'content'],
      },
      handler: (a) =>
        guarded(() => {
          workspace.write(a.path, a.content);
          return `wrote ${a.path}`;
        }),
    }),
    run_tests: defineTool({
      name: 'run_tests',
      description: 'Run the test suite and return {passed, summary}.',
      schema: empty,
      handler: () => guarded(() => ({ ...runTests(workspace) })),
    }),
  };
}

/** A registry holding only the tools the agent's frontmatter grants. */
export function buildToolRegistry(agent: AgentDef, deps: ToolDeps): ToolRegistry {
  const tools = allTools(deps);
  return createRegistry(agent.orchestratorTools.map((name) => tools[name] as ToolDefinition));
}
