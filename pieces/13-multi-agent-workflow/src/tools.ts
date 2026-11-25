import {
  correctable,
  createRegistry,
  err,
  ok,
  type JsonValue,
  type ObjectSchema,
  type ToolDefinition,
  type ToolHandler,
  type ToolRegistry,
} from 'escapement';
import type { AgentDef } from './agents.js';
import type { TestRunner, Workspace } from './workspace.js';

export interface ToolDeps {
  workspace: Workspace;
  runTests: TestRunner;
}

const str = (description: string) => ({ type: 'string' as const, description });
const empty: ObjectSchema = { type: 'object', properties: {} };
const pathSchema: ObjectSchema = {
  type: 'object',
  properties: { path: str('Repository-relative path') },
  required: ['path'],
};

/** Run a workspace operation and turn a thrown message into an observation the model can correct. */
function guarded(fn: () => JsonValue) {
  try {
    return ok(fn());
  } catch (e) {
    return err(correctable('tool.rejected', e instanceof Error ? e.message : String(e)));
  }
}

function allTools({ workspace, runTests }: ToolDeps): Record<string, ToolDefinition> {
  const def = (
    name: string,
    description: string,
    schema: ObjectSchema,
    handler: ToolHandler,
    readOnly = false,
  ): ToolDefinition => ({ name, description, schema, handler, readOnly });
  return {
    read_file: def(
      'read_file',
      'Read one file.',
      pathSchema,
      (a) => guarded(() => workspace.read(a['path'] as string)),
      true,
    ),
    list_files: def(
      'list_files',
      'List every file path.',
      empty,
      () => guarded(() => workspace.list()),
      true,
    ),
    search_files: def(
      'search_files',
      'List files whose content contains the query text.',
      { type: 'object', properties: { query: str('Text to find') }, required: ['query'] },
      (a) => guarded(() => workspace.search(a['query'] as string)),
      true,
    ),
    write_file: def(
      'write_file',
      'Create or replace one file.',
      {
        type: 'object',
        properties: { path: str('Repository-relative path'), content: str('Full new content') },
        required: ['path', 'content'],
      },
      (a) =>
        guarded(() => {
          workspace.write(a['path'] as string, a['content'] as string);
          return `wrote ${a['path'] as string}`;
        }),
    ),
    run_tests: def('run_tests', 'Run the test suite and return {passed, summary}.', empty, () =>
      guarded(() => ({ ...runTests(workspace) })),
    ),
  };
}

/** A registry holding only the tools the agent's frontmatter grants. */
export function buildToolRegistry(agent: AgentDef, deps: ToolDeps): ToolRegistry {
  const tools = allTools(deps);
  return createRegistry(agent.orchestratorTools.map((name) => tools[name] as ToolDefinition));
}
