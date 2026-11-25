/** The demo's working copies. Paths are relative to the piece folder, so output is the same on every run. */
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export const WORK_DIR = 'demo/out/work';
export const PLAN = `${WORK_DIR}/plan.json`;
export const WORKFLOW = `${WORK_DIR}/deploy.yml`;

const SOURCES = {
  violating: [
    ['examples/terraform/plan-violations.json', PLAN],
    ['examples/workflows/deploy-violations.yml', WORKFLOW],
  ],
  fixed: [
    ['examples/terraform/plan-fixed.json', PLAN],
    ['examples/workflows/deploy-fixed.yml', WORKFLOW],
  ],
} as const;

/** Replace the working copies with the violating or the fixed versions. */
export function prepare(state: keyof typeof SOURCES, from = '.'): void {
  if (state === 'violating') rmSync(join(from, WORK_DIR), { recursive: true, force: true });
  mkdirSync(join(from, WORK_DIR), { recursive: true });
  for (const [source, target] of SOURCES[state]) {
    copyFileSync(join(from, source), join(from, target));
  }
}
