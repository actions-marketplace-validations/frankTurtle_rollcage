#!/usr/bin/env node
import { runCli } from './cli.ts';

const code = await runCli(process.argv.slice(2), {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
});
process.exitCode = code;
