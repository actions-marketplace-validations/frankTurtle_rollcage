import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { checkProject, percentOnPath } from './check.ts';
import { runPipeline } from './pipeline.ts';
import { DEFAULT_REF, scaffold, ScaffoldError } from './scaffold.ts';

export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}

const USAGE = `Usage:
  scaffold scaffold <dir> --name <name> --owner <owner> [--ref <ref>]
  scaffold check <dir>...
  scaffold pipeline <dir> [--link-modules <node_modules path>]

--ref is the rollcage tag, branch or commit SHA that pieces 01, 05, 06 and 10 are wired to
(default ${DEFAULT_REF}). Exit codes: 0 ok, 1 refused or failed, 2 usage error.`;

const OPTIONS = {
  name: { type: 'string' },
  owner: { type: 'string' },
  ref: { type: 'string' },
  'link-modules': { type: 'string' },
  help: { type: 'boolean', short: 'h' },
} as const;

function usageError(io: Io, message: string): number {
  io.err(`${message}\n${USAGE}`);
  return 2;
}

function runScaffold(dir: string, values: { name?: string; owner?: string; ref?: string }, io: Io) {
  if (values.name === undefined || values.owner === undefined) {
    return usageError(io, 'scaffold needs --name and --owner');
  }
  try {
    const target = resolve(dir);
    const { name, owner } = values;
    const result = scaffold({
      targetDir: target,
      name,
      owner,
      ...(values.ref === undefined ? {} : { ref: values.ref }),
    });
    io.out(`Created ${result.files.length} files in ${target}`);
    io.out('Pin check: ok');
    for (const w of result.warnings) io.out(`Warning: ${w}`);
    return 0;
  } catch (error) {
    if (!(error instanceof ScaffoldError)) throw error;
    io.err(`scaffold: ${error.message}`);
    return 1;
  }
}

function runCheck(dirs: string[], io: Io): number {
  const results = dirs.map((d) => checkProject(resolve(d)));
  for (const r of results) {
    io.out(`${r.onPath ? 'ON ' : 'OFF'}  ${r.dir}`);
    if (r.missing.length > 0) io.out(`      missing: ${r.missing.join(', ')}`);
    for (const e of r.pinErrors) io.out(`      ${e}`);
  }
  const on = results.filter((r) => r.onPath).length;
  io.out(`${percentOnPath(results)}% on the golden path (${on} of ${results.length})`);
  return on === results.length ? 0 : 1;
}

function runPipelineCommand(dir: string, linkModules: string | undefined, io: Io): number {
  const result = runPipeline(resolve(dir), linkModules === undefined ? {} : { linkModules });
  for (const s of result.steps) {
    io.out(
      `${s.status === 'passed' ? 'PASS' : s.status === 'failed' ? 'FAIL' : 'SKIP'}  ${s.name}`,
    );
    if (s.status === 'failed') io.out(s.output);
  }
  for (const j of result.skipped) io.out(`SKIP  ${j.job} (needs GitHub: ${j.uses})`);
  return result.ok ? 0 : 1;
}

export function runCli(argv: string[], io: Io): number {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (error) {
    return usageError(io, error instanceof Error ? error.message : String(error));
  }
  const { values, positionals } = parsed;
  const [command, ...rest] = positionals;
  if (values.help) {
    io.out(USAGE);
    return 0;
  }
  switch (command) {
    case 'scaffold':
      return rest[0] === undefined
        ? usageError(io, 'scaffold needs a directory')
        : runScaffold(rest[0], values, io);
    case 'check':
      return rest.length === 0 ? usageError(io, 'check needs a directory') : runCheck(rest, io);
    case 'pipeline':
      return rest[0] === undefined
        ? usageError(io, 'pipeline needs a directory')
        : runPipelineCommand(rest[0], values['link-modules'], io);
    default:
      return usageError(
        io,
        command === undefined ? 'no command given' : `unknown command ${command}`,
      );
  }
}
