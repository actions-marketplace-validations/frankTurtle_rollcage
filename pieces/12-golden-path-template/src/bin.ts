import { runCli } from './cli.ts';

process.exitCode = runCli(process.argv.slice(2), {
  out: (text) => console.log(text),
  err: (text) => console.error(text),
});
