import { completeStructured, type LlmClient, type LlmRequest } from '@adl/shared';
import { z } from 'zod';
import type { Explanation, Violation } from './types.js';

const explanationSchema = z.object({
  explanation: z.string().min(1),
  assumptions: z.array(z.string().min(1)).min(1),
});

const SYSTEM = [
  'You explain one infrastructure or workflow policy violation to the engineer who must fix it.',
  'A policy engine already made the pass or fail decision. You do not decide, change or soften it.',
  'Never say a system is compliant, secure or exploitable. You have not seen the system.',
  'List at least one assumption you made. Keep the explanation to two or three plain sentences.',
  'Reply with JSON only: {"explanation": string, "assumptions": string[]}.',
].join(' ');

/** Rule ID, message, file and control IDs. No file contents and no credentials. */
export function buildExplainRequest(v: Violation): LlmRequest {
  return {
    system: SYSTEM,
    prompt: [
      `Rule: ${v.ruleId} (${v.title})`,
      `Violation: ${v.message}`,
      `File: ${v.file}`,
      `Related NIST SP 800-171 controls (illustrative mapping): ${v.controls.join(', ') || 'none'}`,
    ].join('\n'),
    maxTokens: 400,
  };
}

/** Model explanation if it validates, otherwise the rule's own fix text. Never changes pass or fail. */
export async function explainViolation(llm: LlmClient, v: Violation): Promise<Explanation> {
  const result = await completeStructured(llm, buildExplainRequest(v), explanationSchema, () => ({
    explanation: v.remediation,
    assumptions: [],
  }));
  return {
    text: result.value.explanation,
    assumptions: result.value.assumptions,
    source: result.source,
    ...(result.reason ? { reason: result.reason } : {}),
  };
}
