import type { LlmRequest } from '@adl/shared';

export const OPENED = '2026-03-04T14:02:00.000Z';
export const CLOSED = '2026-03-04T15:47:00.000Z';

export const INCIDENT = {
  id: 'INC-204',
  title: 'Checkout latency and errors',
  severity: 'SEV2',
  opened_at: OPENED,
  closed_at: CLOSED,
};

/** Event ids the prompt lists, in order. */
export function promptIds(request: LlmRequest): string[] {
  return [...request.prompt.matchAll(/^(E\d+) \|/gm)].map((m) => m[1] as string);
}

/** A valid model reply that cites real event ids from the prompt. */
export function goodReply(request: LlmRequest): string {
  const ids = promptIds(request);
  return JSON.stringify({
    summary: 'Checkout was slow and returned errors after a deploy.',
    impact: 'Some checkout requests failed during the window. The size of the impact is not known.',
    timeline: [{ event_ids: [ids[0]], description: 'First sign of trouble.' }],
    contributing_factors: [
      {
        description: 'The deploy may have changed connection pool behavior.',
        status: 'hypothesis',
        evidence_event_ids: [ids[1]],
      },
    ],
    action_items: [{ description: 'Add a pool saturation alert.', owner: 'alice-smith' }],
  });
}
