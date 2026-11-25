import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The piece folder: the directory that holds package.json. */
export const PIECE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = resolve(PIECE_ROOT, '..', '..');

export const piecePath = (...parts: string[]): string => join(PIECE_ROOT, ...parts);

export const readPiece = (...parts: string[]): string => readFileSync(piecePath(...parts), 'utf8');

/** A fresh empty directory under the OS temp folder. Tests never write anywhere else. */
export const tmpDir = (): string => mkdtempSync(join(tmpdir(), 'ai-dev-tool-eval-'));
