import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPins } from './pins.ts';
import { validateName, validateOwner, validateRef } from './validate.ts';

export const TEMPLATE_DIR = join(dirname(fileURLToPath(import.meta.url)), '../template');
export const DEFAULT_REF = 'v0.2.0';

export class ScaffoldError extends Error {}

export interface ScaffoldOptions {
  targetDir: string;
  name: string;
  owner: string;
  ref?: string;
  templateDir?: string;
}

export interface ScaffoldResult {
  files: string[];
  warnings: string[];
}

/** Relative paths (forward slashes) of every file under `dir`. */
export function walk(dir: string, rel = ''): string[] {
  return readdirSync(join(dir, rel), { withFileTypes: true }).flatMap((entry) => {
    const path = rel ? `${rel}/${entry.name}` : entry.name;
    return entry.isDirectory() ? walk(dir, path) : [path];
  });
}

/** `.gitignore` is stored as `gitignore` so the template folder does not ignore itself. */
function destinationPath(rel: string): string {
  return rel === 'gitignore' ? '.gitignore' : rel;
}

function assertEmptyTarget(targetDir: string): void {
  if (!existsSync(targetDir)) return;
  if (!statSync(targetDir).isDirectory()) {
    throw new ScaffoldError(`${targetDir} exists and is not a directory`);
  }
  if (readdirSync(targetDir).length > 0) {
    throw new ScaffoldError(`${targetDir} is not empty; scaffold never overwrites existing files`);
  }
}

/**
 * Generate a project from the template. Everything is validated and rendered in memory first, so
 * a failure writes nothing.
 */
export function scaffold(options: ScaffoldOptions): ScaffoldResult {
  const { targetDir, name, owner, ref = DEFAULT_REF, templateDir = TEMPLATE_DIR } = options;
  const problem = validateName(name) ?? validateOwner(owner) ?? validateRef(ref);
  if (problem) throw new ScaffoldError(problem);
  assertEmptyTarget(targetDir);

  const values: Record<string, string> = {
    __NAME__: name,
    __OWNER__: owner,
    __ROLLCAGE_REF__: ref,
  };
  const rendered = new Map<string, string>();
  for (const rel of walk(templateDir)) {
    const text = readFileSync(join(templateDir, rel), 'utf8').replace(
      /__(NAME|OWNER|ROLLCAGE_REF)__/g,
      (token) => values[token] ?? token,
    );
    rendered.set(destinationPath(rel), text);
  }

  const workflows = Object.fromEntries(
    [...rendered].filter(([rel]) => rel.startsWith('.github/workflows/')),
  );
  const pins = checkPins(workflows, ref);
  if (pins.errors.length > 0) {
    throw new ScaffoldError(`pin check failed:\n${pins.errors.join('\n')}`);
  }

  for (const [rel, text] of rendered) {
    const full = join(targetDir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text, { flag: 'wx' });
  }
  return { files: [...rendered.keys()], warnings: pins.warnings };
}
