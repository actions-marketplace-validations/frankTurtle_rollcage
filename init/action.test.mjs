// The root action.yml pins every piece to one release tag and must only point at real pieces.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { URL } from 'node:url';

const root = new URL('..', import.meta.url);
const action = readFileSync(new URL('action.yml', root), 'utf8');
const refs = [...action.matchAll(/uses: frankTurtle\/rollcage\/(pieces\/[\w-]+)@(v[\d.]+)/g)];

test('root action covers eight pieces on one version, and each piece has an action.yml', () => {
  assert.equal(refs.length, 8);
  assert.equal(new Set(refs.map((m) => m[2])).size, 1);
  for (const [, dir] of refs) assert.ok(existsSync(new URL(`${dir}/action.yml`, root)), dir);
});

test('every piece step is gated on the piece input', () => {
  assert.equal(action.match(/if: inputs\.piece == '[\w-]+'/g)?.length, refs.length);
});
