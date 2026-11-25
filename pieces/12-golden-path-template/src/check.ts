import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkPins } from './pins.ts';
import { walk } from './scaffold.ts';

/** Files a repo needs to count as on the golden path. */
export const REQUIRED_FILES = [
  '.golden-path.json',
  '.pre-commit-config.yaml',
  '.github/CODEOWNERS',
  '.github/dependabot.yml',
  '.github/pull_request_template.md',
  '.github/workflows/ci.yml',
  '.github/workflows/build-test.yml',
  '.github/workflows/gate-pr-risk.yml',
  '.github/workflows/secrets-scan.yml',
  '.github/workflows/sbom-vuln.yml',
  '.github/workflows/policy-gates.yml',
  '.github/workflows/provenance.yml',
  'risk-gate.yml',
  'SECURITY.md',
  'docs/branch-protection.md',
];

export interface ProjectCheck {
  dir: string;
  onPath: boolean;
  missing: string[];
  pinErrors: string[];
}

function markerRef(dir: string): string {
  try {
    const marker: unknown = JSON.parse(readFileSync(join(dir, '.golden-path.json'), 'utf8'));
    const ref = (marker as { ref?: unknown }).ref;
    return typeof ref === 'string' ? ref : '';
  } catch {
    return '';
  }
}

function readWorkflows(dir: string): Record<string, string> {
  const root = join(dir, '.github/workflows');
  if (!existsSync(root)) return {};
  return Object.fromEntries(
    walk(root)
      .filter((f) => /\.ya?ml$/.test(f))
      .map((f) => [f, readFileSync(join(root, f), 'utf8')]),
  );
}

/** A directory is on the path when every required file exists and every action is pinned. */
export function checkProject(dir: string): ProjectCheck {
  const missing = REQUIRED_FILES.filter((f) => !existsSync(join(dir, f)));
  const pinErrors = checkPins(readWorkflows(dir), markerRef(dir)).errors;
  return { dir, onPath: missing.length === 0 && pinErrors.length === 0, missing, pinErrors };
}

/** Whole-number percentage of the checked directories that are on the path. */
export function percentOnPath(results: ProjectCheck[]): number {
  if (results.length === 0) return 0;
  return Math.round((100 * results.filter((r) => r.onPath).length) / results.length);
}
