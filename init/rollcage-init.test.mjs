import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PIECES, parsePieces, parseRemote, run } from './rollcage-init.mjs';

const SOURCE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHA_PIN = /@[0-9a-f]{40} # \S+/;

function repo(files = {}, remote = 'https://github.com/acme/widgets.git') {
  const dir = mkdtempSync(join(tmpdir(), 'rollcage-init-test-'));
  execFileSync('git', ['init', '--quiet'], { cwd: dir });
  if (remote) execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: dir });
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

function init(dir, ...args) {
  const out = [];
  const err = [];
  const code = run(['--dir', dir, '--source', SOURCE, '--no-build', ...args], {
    out: (t) => out.push(t),
    err: (t) => err.push(t),
  });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

const read = (dir, path) => readFileSync(join(dir, path), 'utf8');

test('parsePieces: defaults, only, without, and bad input', () => {
  assert.deepEqual(parsePieces(), DEFAULT_PIECES);
  assert.deepEqual(parsePieces('1,4'), ['01', '04']);
  assert.deepEqual(parsePieces(undefined, '3,10'), ['01', '02', '04', '05', '06']);
  assert.throws(() => parsePieces('07'), /not-yet-supported piece 07/);
});

test('parseRemote handles https and ssh remotes', () => {
  assert.deepEqual(parseRemote('git@github.com:acme/widgets.git'), {
    owner: 'acme',
    repo: 'widgets',
  });
  assert.deepEqual(parseRemote('https://github.com/acme/widgets'), {
    owner: 'acme',
    repo: 'widgets',
  });
  assert.equal(parseRemote('https://gitlab.com/acme/widgets'), null);
});

test('empty repo: writes every default piece, pinned by SHA, nothing unfilled', () => {
  const dir = repo();
  const { code, out } = init(dir);
  assert.equal(code, 0, out);
  for (const path of [
    '.github/workflows/rollcage.yml',
    '.github/workflows/gate-pr-risk.yml',
    '.github/workflows/agent-policy.yml',
    '.github/workflows/secrets-scan.yml',
    '.github/workflows/sbom-vuln.yml',
    '.github/workflows/policy-gates.yml',
    '.github/workflows/dora-weekly.yml',
    '.github/workflows/provenance.yml',
    '.claude/settings.json',
    '.claude/agent-policy.yml',
    'policy/AI_CODING_AGENT_POLICY.md',
    'risk-gate.yml',
    '.rollcage.json',
  ]) {
    assert.ok(existsSync(join(dir, path)), `${path} should exist`);
  }
  for (const file of ['gate-pr-risk', 'sbom-vuln', 'policy-gates', 'dora-weekly', 'provenance']) {
    assert.match(read(dir, `.github/workflows/${file}.yml`), SHA_PIN, file);
  }
  assert.match(read(dir, '.github/workflows/agent-policy.yml'), SHA_PIN);
  assert.match(read(dir, '.github/CODEOWNERS'), /@acme/);
  assert.match(read(dir, '.github/workflows/provenance.yml'), /acme\/widgets\/\.github/);
  assert.equal(read(dir, 'risk-gate.yml').includes('mode: observe'), true);
  const workflows = readdirSync(join(dir, '.github/workflows'))
    .map((f) => read(dir, `.github/workflows/${f}`))
    .join('\n');
  assert.equal(workflows.includes('__'), false, 'no template tokens left');
  const policy = read(dir, 'policy/AI_CODING_AGENT_POLICY.md');
  assert.equal(/<[A-Z][A-Z /_]*>/.test(policy), false, 'policy placeholders filled');
});

test('non-pnpm repo gets no pnpm/action-setup step; a pnpm repo keeps it', () => {
  const plain = repo({ 'package.json': '{"name":"x"}' });
  init(plain);
  assert.equal(
    read(plain, '.github/workflows/gate-pr-risk.yml').includes('pnpm/action-setup'),
    false,
  );
  assert.equal(
    read(plain, '.github/workflows/dora-weekly.yml').includes('pnpm/action-setup'),
    false,
  );

  const pnpm = repo({ 'package.json': '{"name":"x","packageManager":"pnpm@10.30.3"}' });
  init(pnpm);
  assert.match(read(pnpm, '.github/workflows/gate-pr-risk.yml'), /pnpm\/action-setup@/);
  assert.match(read(pnpm, '.github/workflows/dora-weekly.yml'), /pnpm\/action-setup@/);
});

test('never overwrites, and does not duplicate jobs an existing ci.yml already calls', () => {
  const dir = repo({
    'risk-gate.yml': 'mode: enforce\n',
    '.github/workflows/ci.yml': `jobs:
  risk-gate:
    uses: ./.github/workflows/gate-pr-risk.yml
  secrets:
    uses: ./.github/workflows/secrets-scan.yml
`,
  });
  const { code, out } = init(dir);
  assert.equal(code, 0, out);
  assert.equal(read(dir, 'risk-gate.yml'), 'mode: enforce\n');
  assert.match(out, /skipped\s+risk-gate\.yml/);
  const caller = read(dir, '.github/workflows/rollcage.yml');
  assert.equal(caller.includes('gate-pr-risk.yml'), false);
  assert.equal(caller.includes('secrets-scan.yml'), false);
  assert.match(caller, /sbom-vuln\.yml/);
});

test('second run is a no-op that writes nothing new', () => {
  const dir = repo();
  init(dir);
  const again = init(dir);
  assert.equal(again.code, 0);
  assert.equal(/\bwritten\b/.test(again.out), false);
});

test('--pieces and --without limit what is written; --dry-run writes nothing', () => {
  const only = repo();
  init(only, '--pieces', '04');
  assert.ok(existsSync(join(only, '.github/workflows/secrets-scan.yml')));
  assert.equal(existsSync(join(only, '.github/workflows/gate-pr-risk.yml')), false);
  assert.equal(existsSync(join(only, '.claude')), false);

  const dry = repo();
  const { out } = init(dry, '--dry-run');
  assert.match(out, /would-write\s+\.github\/workflows\/rollcage\.yml/);
  assert.equal(existsSync(join(dry, '.github')), false);
});

test('refuses a non-repo and a missing owner, and reports usage errors', () => {
  const notRepo = mkdtempSync(join(tmpdir(), 'rollcage-init-test-'));
  assert.equal(init(notRepo).code, 1);
  assert.match(init(repo({}, null)).err, /pass --owner/);
  assert.equal(run(['--nope'], { out() {}, err() {} }), 2);
  assert.equal(run(['--help'], { out() {}, err() {} }), 0);
});

test('piece 02 hook is reported as a manual step when not built', () => {
  const dir = repo();
  const { out } = init(dir);
  assert.match(out, /manual\s+\.claude\/hooks\/agent-policy-hook\.mjs/);
  assert.match(out, /Build the agent hook/);
});

test('embedded action pins match piece 12 template, and a dash-leading ref is rejected', () => {
  const template = readFileSync(
    join(SOURCE, 'pieces/12-golden-path-template/template/.github/workflows/build-test.yml'),
    'utf8',
  );
  const dir = repo();
  init(dir);
  const generated = read(dir, '.github/workflows/agent-policy.yml');
  const pin = /actions\/checkout@[0-9a-f]{40} # \S+/;
  assert.equal(generated.match(pin)?.[0], template.match(pin)?.[0]);
  assert.match(init(repo(), '--ref=--upload-pack=x').err, /invalid --ref/);
});
