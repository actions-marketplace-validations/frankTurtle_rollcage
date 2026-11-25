import { MAPPING_LABEL } from './mapping.js';
import type { Explanation, Violation } from './types.js';

/** Plain text report: short lines, one block per file. */
export function formatReport(
  violations: Violation[],
  explanations: (Explanation | undefined)[],
): string {
  const lines: string[] = [];
  let current: string | undefined;
  violations.forEach((v, i) => {
    if (v.file !== current) {
      current = v.file;
      lines.push(`FAIL ${v.file}`);
    }
    lines.push(`  ${v.ruleId} ${v.message}`);
    const controls = v.controls.length > 0 ? v.controls.join(', ') : 'no mapping';
    lines.push(`        NIST SP 800-171: ${controls}`);
    lines.push(...explanationLines(v, explanations[i]));
  });
  const files = new Set(violations.map((v) => v.file)).size;
  lines.push('');
  lines.push(
    violations.length === 0
      ? 'Gate passed: no violations.'
      : `Gate failed: ${violations.length} ${plural(violations.length, 'violation')} in ${files} ${plural(files, 'file')}.`,
  );
  lines.push(`Control IDs are an ${MAPPING_LABEL}.`);
  return lines.join('\n');
}

function explanationLines(v: Violation, e: Explanation | undefined): string[] {
  if (!e) return [`        Fix: ${v.remediation}`];
  if (e.source === 'fallback') {
    return [`        Fix (model output was not usable, using the rule text): ${e.text}`];
  }
  return [
    `        AI explanation (model output, not a finding): ${e.text}`,
    ...e.assumptions.map((a) => `        Assumption: ${a}`),
  ];
}

const plural = (n: number, word: string) => (n === 1 ? word : `${word}s`);
