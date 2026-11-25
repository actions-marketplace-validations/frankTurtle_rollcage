import { runCli } from './cli.ts';
import { execRunner } from './runner.ts';

process.exitCode = await runCli(process.argv.slice(2), {
  runner: execRunner(),
  out: (text) => console.log(text),
  err: (text) => console.error(text),
});
