import { runCli } from './cli.js';
import { createConftestRunner } from './conftest.js';
import { createLlm } from './llm.js';
import { LLM_FIXTURE_DIR } from './paths.js';

process.exitCode = await runCli(process.argv.slice(2), {
  env: process.env,
  out: (text) => console.log(text),
  err: (text) => console.error(text),
  runner: createConftestRunner(),
  createLlm: (live) => createLlm(live, process.env, LLM_FIXTURE_DIR),
});
