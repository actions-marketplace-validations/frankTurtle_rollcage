import { SHA } from './validate.ts';

export const ROLLCAGE_PREFIX = 'frankTurtle/rollcage/';

export interface Use {
  ref: string;
  line: number;
}

export interface PinResult {
  errors: string[];
  warnings: string[];
}

const USES = /^\s*(?:-\s+)?uses:\s*["']?([^\s"'#]+)/;
const THIRD_PARTY = /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/;

/** Every `uses:` reference in a workflow, with its 1-based line number. */
export function findUses(text: string): Use[] {
  const found: Use[] = [];
  text.split('\n').forEach((line, i) => {
    const ref = USES.exec(line)?.[1];
    if (ref) found.push({ ref, line: i + 1 });
  });
  return found;
}

/**
 * Check every action reference in the given workflow files (name to text).
 * Local references pass. Rollcage pieces must use `rollcageRef`. Everything else must be pinned to
 * a 40 character commit SHA.
 */
export function checkPins(files: Record<string, string>, rollcageRef: string): PinResult {
  const errors: string[] = [];
  let movableRefs = 0;
  for (const [file, text] of Object.entries(files)) {
    for (const { ref, line } of findUses(text)) {
      const where = `${file}:${line} ${ref}`;
      if (ref.startsWith('./')) continue;
      if (ref.startsWith(ROLLCAGE_PREFIX)) {
        if (ref.split('@')[1] !== rollcageRef) {
          errors.push(`${where} does not use the configured ref ${rollcageRef}`);
        } else if (!SHA.test(rollcageRef)) {
          movableRefs += 1;
        }
      } else if (ref.startsWith('docker://')) {
        errors.push(`${where} is a container reference; pin an action by commit SHA instead`);
      } else if (!THIRD_PARTY.test(ref)) {
        errors.push(`${where} is not pinned to a commit SHA`);
      }
    }
  }
  const warnings =
    movableRefs > 0
      ? [
          `ref ${rollcageRef} is not a commit SHA, so ${movableRefs} rollcage references can move.\n` +
            '  Resolve it with git ls-remote and pass the SHA as --ref.',
        ]
      : [];
  return { errors, warnings };
}
