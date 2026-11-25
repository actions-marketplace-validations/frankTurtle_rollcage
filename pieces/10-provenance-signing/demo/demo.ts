/**
 * Demo driver. Builds a sample npm tarball, signs it with a THROWAWAY key generated into
 * demo/out (gitignored, empty password), and runs the real deploy gate against it. No keyless
 * signing, no transparency log, no network.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execRunner, header, runStages } from '@adl/shared';
import { runCli } from '../src/cli.ts';
import { generateKeyPair, signBlob } from '../src/sign.ts';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'out');
const samplePackage = join(here, '..', 'sample-package');

// Paths below are relative to demo/out so the commands on screen are short.
const GOOD = 'deploy/pkg-signed.tgz';
const TAMPERED = 'deploy/pkg-tampered.tgz';
const UNSIGNED = 'deploy/pkg-unsigned.tgz';
const PUBLIC_KEY = 'signer/demo.pub';
const PRIVATE_KEY = 'signer/demo.key';
const TARBALL = 'build/rollcage-sample-1.0.0.tgz';

const runner = execRunner({ timeoutMs: 60_000, env: { COSIGN_PASSWORD: '' } });
const say = (text: string): void => console.log(text);

/** Flip one bit in the middle of the file. */
function tamper(path: string): void {
  const bytes = readFileSync(path);
  const at = Math.floor(bytes.length / 2);
  bytes[at] = (bytes[at] ?? 0) ^ 0x01;
  writeFileSync(path, bytes);
}

async function buildTarball(): Promise<void> {
  mkdirSync(join(out, 'build'), { recursive: true });
  const r = await runner('npm', ['pack', samplePackage, '--pack-destination', join(out, 'build')]);
  if (r.code !== 0) throw new Error(`npm pack failed: ${r.error ?? r.stderr.trim()}`);
}

async function ensureKeys(): Promise<void> {
  if (existsSync(PUBLIC_KEY)) return;
  mkdirSync('signer', { recursive: true });
  await generateKeyPair(runner, 'signer/demo');
}

/** Rebuild the deploy folder from scratch: one clean copy of the tarball. */
async function freshDeploy(): Promise<void> {
  await buildTarball();
  rmSync('deploy', { recursive: true, force: true });
  mkdirSync('deploy', { recursive: true });
  copyFileSync(TARBALL, GOOD);
}

async function sign(artifact: string): Promise<void> {
  await signBlob(runner, {
    key: PRIVATE_KEY,
    artifact,
    bundle: `${artifact}.sigstore.json`,
  });
}

const GATE_ARGS = ['gate', '--mode', 'key', '--public-key', PUBLIC_KEY, '--allow-no-tlog'];

async function gate(artifacts: string[], extra: string[] = []): Promise<number> {
  const args = [...GATE_ARGS, ...artifacts.flatMap((a) => ['--artifact', a]), ...extra];
  say(`$ provenance ${args.join(' ')}`);
  const code = await runCli(args, { runner, out: say, err: (t) => console.error(t) });
  say(`exit code: ${code}`);
  return code;
}

async function before(): Promise<void> {
  header('BEFORE: a deploy step that checks nothing');
  await freshDeploy();
  copyFileSync(GOOD, TAMPERED);
  tamper(TAMPERED);
  for (const file of [GOOD, TAMPERED]) {
    const ok = existsSync(file);
    say(`deploy ${file}: file exists, ${ok ? 'ACCEPTED' : 'rejected'}`);
  }
  say('One of those files has a changed byte. Nothing noticed.');
}

async function run(): Promise<void> {
  header('RUN: sign the tarball, then run the deploy gate');
  await ensureKeys();
  await freshDeploy();
  await sign(GOOD);
  say(`Signed ${GOOD} with a throwaway key (no transparency log).`);
  await gate([GOOD]);
}

async function after(): Promise<void> {
  header('AFTER: change one byte, run the gate again');
  await ensureKeys();
  await freshDeploy();
  await sign(GOOD);
  tamper(GOOD);
  say(`Changed one byte in ${GOOD} after it was signed.`);
  await gate([GOOD]);
}

async function metric(): Promise<void> {
  header('METRIC: % of deployed artifacts signed and verified (fixture)');
  await ensureKeys();
  await freshDeploy();
  await sign(GOOD);
  copyFileSync(GOOD, TAMPERED);
  copyFileSync(`${GOOD}.sigstore.json`, `${TAMPERED}.sigstore.json`);
  tamper(TAMPERED);
  copyFileSync(TARBALL, UNSIGNED);
  say('Three artifacts: signed and untouched, signed then tampered, never signed.');
  await gate([GOOD, TAMPERED, UNSIGNED], ['--report', 'deploy/gate-report.json']);
  say('');
  say('$ provenance metric --report deploy/gate-report.json');
  await runCli(['metric', '--report', 'deploy/gate-report.json'], {
    runner,
    out: say,
    err: (t) => console.error(t),
  });
}

mkdirSync(out, { recursive: true });
process.chdir(out);
const requested = process.argv[2] ?? 'all';
if (requested === 'all') rmSync(join(out, 'signer'), { recursive: true, force: true });
try {
  process.exitCode = await runStages({ before, run, after, metric }, requested);
} catch (e) {
  console.error(`demo failed: ${e instanceof Error ? e.message : String(e)}`);
  console.error('The demo needs cosign and npm on the PATH. No network is used.');
  process.exitCode = 3;
}
