import { runCli } from './cli.ts';
import { execRunner } from '@adl/shared';

process.exitCode = await runCli(process.argv.slice(2), {
  runner: execRunner({ timeoutMs: 60_000 }),
  out: (text) => console.log(text),
  err: (text) => console.error(text),
});
