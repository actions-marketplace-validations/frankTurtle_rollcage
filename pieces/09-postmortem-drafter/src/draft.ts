import { completeStructured } from '@adl/shared';
import type { LlmClient } from '@adl/shared';
import { z } from 'zod';
import { Redactor, assertClean } from '@adl/shared';
import type { RedactionReport } from '@adl/shared';
import { buildTimeline } from './timeline.js';
import type { Bundle, Incident, TimelineEvent } from './types.js';

/** A deploy this close before the incident opened is offered as a hypothesis in the fallback. */
const DEPLOY_WINDOW_MIN = 60;
const MAX_EVENT_CHARS = 400;
const DEFAULT_MAX_EVENTS = 200;

export interface DraftOptions {
  /** Inject a redactor. Tests use this to prove the pre-call guard works. */
  redactor?: Redactor;
  maxEvents?: number;
}

export interface Postmortem {
  summary: string;
  impact: string;
  timeline: { eventIds: string[]; description: string }[];
  factors: { description: string; evidence: string[] }[];
  actions: string[];
}

export interface DraftResult {
  markdown: string;
  source: 'model' | 'fallback';
  reason?: string;
  report: RedactionReport;
  /** The redacted, pseudonymized timeline the model saw (or would have seen). */
  timeline: TimelineEvent[];
  draft: Postmortem;
}

/** The model's JSON. Event ids must exist; factors must be hypotheses and cite evidence. */
function schemaFor(ids: Set<string>) {
  const eventId = z.string().refine((id) => ids.has(id), { message: 'unknown event id' });
  return z.object({
    summary: z.string().min(1),
    impact: z.string().min(1),
    timeline: z.array(
      z.object({ event_ids: z.array(eventId).min(1), description: z.string().min(1) }),
    ),
    contributing_factors: z.array(
      z.object({
        description: z.string().min(1),
        status: z.literal('hypothesis'),
        evidence_event_ids: z.array(eventId).min(1),
      }),
    ),
    action_items: z.array(z.object({ description: z.string().min(1) })),
  });
}

type ModelOutput = z.infer<ReturnType<typeof schemaFor>>;

function toPostmortem(m: ModelOutput): Postmortem {
  return {
    summary: m.summary,
    impact: m.impact,
    timeline: m.timeline.map((t) => ({ eventIds: t.event_ids, description: t.description })),
    factors: m.contributing_factors.map((f) => ({
      description: f.description,
      evidence: f.evidence_event_ids,
    })),
    actions: m.action_items.map((a) => a.description),
  };
}

const SYSTEM = `You draft blameless incident postmortems for an engineering team.
Reply with one JSON object and nothing else, in this shape:
{"summary": string, "impact": string,
 "timeline": [{"event_ids": ["E01"], "description": string}],
 "contributing_factors": [{"description": string, "status": "hypothesis", "evidence_event_ids": ["E01"]}],
 "action_items": [{"description": string}]}
Rules:
- Use only the events given. Cite event ids from the list; never invent ids or facts.
- Every contributing factor is a hypothesis with at least one evidence event id. Never state a root cause as confirmed.
- Blameless: describe systems and decisions, not people. Participants appear as participant-N; do not guess who they are.
- Bracketed tokens like [EMAIL_1] stand for removed sensitive values. Do not guess or restore them.
- If the events do not show the impact, say it is not known.
- Do not assign owners or due dates.`;

function trim(text: string): string {
  return text.length > MAX_EVENT_CHARS ? `${text.slice(0, MAX_EVENT_CHARS)}...` : text;
}

const describe = (e: TimelineEvent): string => (e.actor ? `${e.actor}: ${e.text}` : e.text);

function durationMinutes(incident: Incident): number {
  return Math.round((Date.parse(incident.closed_at) - Date.parse(incident.opened_at)) / 60_000);
}

function buildPrompt(incident: Incident, events: TimelineEvent[], maxEvents: number): string {
  let shown = events;
  let omitted = 0;
  if (events.length > maxEvents) {
    const head = Math.ceil(maxEvents * 0.6);
    shown = [...events.slice(0, head), ...events.slice(events.length - (maxEvents - head))];
    omitted = events.length - maxEvents;
  }
  const lines = shown.map((e) => `${e.id} | ${e.at} | ${e.source} | ${trim(describe(e))}`);
  if (omitted > 0) lines.splice(Math.ceil(maxEvents * 0.6), 0, `(${omitted} events omitted here)`);
  return [
    `Incident ${incident.id}: ${incident.title} (severity ${incident.severity})`,
    `Opened ${incident.opened_at}, closed ${incident.closed_at} (${durationMinutes(incident)} minutes), all times UTC.`,
    'Events, one per line as: id | time | source | text',
    ...lines,
  ].join('\n');
}

function fallbackModelOutput(incident: Incident, events: TimelineEvent[]): ModelOutput {
  const opened = Date.parse(incident.opened_at);
  const factors = events
    .filter((e) => e.source === 'deploy' && e.at <= incident.opened_at)
    .filter((e) => (opened - Date.parse(e.at)) / 60_000 <= DEPLOY_WINDOW_MIN)
    .map((e) => ({
      description: `A deploy (${e.text}) went out ${Math.round((opened - Date.parse(e.at)) / 60_000)} minutes before the incident opened. This is a time correlation only.`,
      status: 'hypothesis' as const,
      evidence_event_ids: [e.id],
    }));
  return {
    summary: `Incident ${incident.id} (${incident.title}, severity ${incident.severity}) ran from ${incident.opened_at} to ${incident.closed_at} UTC, ${durationMinutes(incident)} minutes, with ${events.length} events in the bundle. Write the summary after reading the timeline.`,
    impact:
      'Impact has not been assessed. Record who was affected and for how long; the exported data does not say.',
    timeline: events.map((e) => ({
      event_ids: [e.id],
      description: `${e.source}: ${describe(e)}`,
    })),
    contributing_factors: factors,
    action_items: [
      {
        description:
          'Confirm each contributing factor above, or replace it, and record the evidence.',
      },
      { description: 'Record who was affected and for how long.' },
      { description: 'Review whether detection and alerting fired as early as they could have.' },
    ],
  };
}

const cell = (text: string): string => text.replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|');

function render(args: {
  incident: Incident;
  draft: Postmortem;
  events: TimelineEvent[];
  source: 'model' | 'fallback';
  reason: string | undefined;
  report: RedactionReport;
}): string {
  const { incident, draft, events, source, reason, report } = args;
  const at = new Map(events.map((e) => [e.id, e.at]));
  const banner =
    source === 'model'
      ? '> Draft written by a model from redacted input. Check every statement against the events before publishing.'
      : `> This draft was generated without a model: ${reason}. Summary, impact and action items are prompts to fill in.`;
  const factors = draft.factors.length
    ? draft.factors.map(
        (f) => `- [hypothesis] ${cell(f.description)} (evidence: ${f.evidence.join(', ')})`,
      )
    : [
        source === 'model'
          ? 'None proposed.'
          : 'No deploy shortly before onset was found in the bundle. A person needs to propose hypotheses.',
      ];
  const lines = [
    `# Postmortem draft: ${incident.id} ${incident.title}`,
    '',
    banner,
    '',
    `Severity ${incident.severity}. Opened ${incident.opened_at}. Closed ${incident.closed_at}. Duration ${durationMinutes(incident)} minutes. All times UTC.`,
    '',
    '## Summary',
    '',
    cell(draft.summary),
    '',
    '## Impact',
    '',
    cell(draft.impact),
    '',
    '## Timeline',
    '',
    ...draft.timeline.map(
      (t) =>
        `- ${at.get(t.eventIds[0] as string)} (${t.eventIds.join(', ')}) ${cell(t.description)}`,
    ),
    '',
    '## Contributing factors (hypotheses)',
    '',
    ...factors,
    '',
    '## Action items',
    '',
    '| Action | Owner |',
    '| --- | --- |',
    ...draft.actions.map((a) => `| ${cell(a)} |  |`),
    '',
  ];
  if (source === 'model') {
    lines.push(
      '## Appendix: event timeline',
      '',
      '| ID | Time (UTC) | Source | Event |',
      '| --- | --- | --- | --- |',
      ...events.map((e) => `| ${e.id} | ${e.at} | ${e.source} | ${cell(describe(e))} |`),
      '',
    );
  }
  lines.push(
    '## Redaction report',
    '',
    `${report.total} values removed before the text left this machine. Counts only.`,
    '',
    '| Type | Occurrences | Unique values |',
    '| --- | --- | --- |',
    ...Object.entries(report.byType).map(([t, c]) => `| ${t} | ${c.occurrences} | ${c.unique} |`),
    '',
  );
  return lines.join('\n');
}

export async function draftPostmortem(
  bundle: Bundle,
  llm: LlmClient,
  options: DraftOptions = {},
): Promise<DraftResult> {
  const redactor = options.redactor ?? new Redactor();
  const incident: Incident = {
    ...bundle.incident,
    id: redactor.redact(bundle.incident.id),
    title: redactor.redact(bundle.incident.title),
    severity: redactor.redact(bundle.incident.severity),
  };
  const events = buildTimeline(bundle.events).map((e) => ({ ...e, text: redactor.redact(e.text) }));

  const prompt = buildPrompt(incident, events, options.maxEvents ?? DEFAULT_MAX_EVENTS);
  assertClean(`${SYSTEM}\n${prompt}`);

  const result = await completeStructured(
    llm,
    { system: SYSTEM, prompt, maxTokens: 2000 },
    schemaFor(new Set(events.map((e) => e.id))),
    () => fallbackModelOutput(incident, events),
  );

  // The model only saw placeholders, but its output is checked in case it invents a value.
  const m = toPostmortem(result.value);
  const clean = (s: string): string => redactor.redact(s);
  const draft: Postmortem = {
    summary: clean(m.summary),
    impact: clean(m.impact),
    timeline: m.timeline.map((t) => ({ ...t, description: clean(t.description) })),
    factors: m.factors.map((f) => ({ ...f, description: clean(f.description) })),
    actions: m.actions.map(clean),
  };
  const report = redactor.report();
  return {
    markdown: render({
      incident,
      draft,
      events,
      source: result.source,
      reason: result.reason,
      report,
    }),
    source: result.source,
    ...(result.reason ? { reason: result.reason } : {}),
    report,
    timeline: events,
    draft,
  };
}
