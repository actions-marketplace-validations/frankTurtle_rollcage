import { describe, expect, it } from 'vitest';
import { parseBundleFiles } from '../src/bundle.js';
import { parseChat, parseCloudWatch, parseDeploys, parseNotes } from '../src/ingest.js';
import { buildTimeline } from '../src/timeline.js';
import { INCIDENT } from './helpers.js';

const T = '2026-03-04T14:05:00.000Z';
const MS = Date.parse(T);

describe('AC-2 ingest', () => {
  it('reads filter-log-events output and a bare array', () => {
    const wrapped = JSON.stringify({ events: [{ timestamp: MS, message: ' boom ' }] });
    const bare = JSON.stringify([{ timestamp: MS, message: 'boom', logStreamName: 's1' }]);
    expect(parseCloudWatch(wrapped)).toEqual([{ at: T, source: 'log', text: 'boom' }]);
    expect(parseCloudWatch(bare)[0]?.text).toBe('boom');
  });

  it('reads chat timestamps as ISO with offset, no zone, epoch seconds and epoch milliseconds', () => {
    const chat = JSON.stringify([
      { ts: '2026-03-04T09:05:00-05:00', user: 'a', text: 'one' },
      { ts: '2026-03-04 14:05:00', user: 'a', text: 'two' },
      { ts: MS / 1000, user: 'a', text: 'three' },
      { ts: String(MS), user: 'a', text: 'four' },
    ]);
    expect(parseChat(chat).map((e) => e.at)).toEqual([T, T, T, T]);
  });

  it('reads notes lines with a time, rolls past midnight and ignores other lines', () => {
    const md = [
      '# Notes',
      'intro text',
      '- 23:50 UTC late',
      '* 00:10 after midnight',
      '14:05Z - plain',
    ].join('\n');
    const events = parseNotes(md, '2026-03-04T23:00:00Z');
    expect(events.map((e) => [e.at, e.text])).toEqual([
      ['2026-03-04T23:50:00.000Z', 'late'],
      ['2026-03-05T00:10:00.000Z', 'after midnight'],
      ['2026-03-05T14:05:00.000Z', 'plain'],
    ]);
  });

  it('reads deploys with optional deployer and status', () => {
    const raw = JSON.stringify([
      { at: T, service: 'checkout', version: 'v1.2.3', deployer: 'alice' },
      { at: T, service: 'cart', version: 'v2', status: 'rolled_back' },
    ]);
    const events = parseDeploys(raw);
    expect(events[0]).toMatchObject({ source: 'deploy', actor: 'alice' });
    expect(events[0]?.text).toContain('checkout v1.2.3 (succeeded)');
    expect(events[1]?.text).toContain('(rolled_back)');
  });

  it('names the file when input is malformed', () => {
    expect(() => parseCloudWatch('{')).toThrow(/logs\.json/);
    expect(() => parseChat(JSON.stringify([{ ts: T, user: 'a' }]))).toThrow(/chat\.json/);
    expect(() => parseChat(JSON.stringify([{ ts: 'not a time', user: 'a', text: 'x' }]))).toThrow(
      /chat\.json/,
    );
    expect(() => parseDeploys('[{"at":1}]')).toThrow(/deploys\.json/);
  });

  it('builds a bundle from files and requires logs, deploys and a chat or notes source', () => {
    const files = {
      'incident.json': JSON.stringify(INCIDENT),
      'logs.json': '[]',
      'deploys.json': '[]',
      'notes.md': `- 14:05 hello`,
    };
    const bundle = parseBundleFiles(files);
    expect(bundle.incident.id).toBe('INC-204');
    expect(bundle.events).toHaveLength(1);
    expect(() => parseBundleFiles({ ...files, 'notes.md': undefined })).toThrow(/chat\.json/);
    expect(() => parseBundleFiles({ ...files, 'logs.json': undefined })).toThrow(/logs\.json/);
    expect(() => parseBundleFiles({ ...files, 'incident.json': '{}' })).toThrow(/incident\.json/);
    expect(() =>
      parseBundleFiles({
        ...files,
        'incident.json': JSON.stringify({ ...INCIDENT, opened_at: 'x' }),
      }),
    ).toThrow(/incident\.json/);
  });
});

describe('AC-1 timeline', () => {
  it('merges sources, sorts by time, dedupes exact duplicates and assigns ids', () => {
    const t2 = '2026-03-04T14:06:00.000Z';
    const timeline = buildTimeline([
      { at: t2, source: 'chat', actor: 'bob', text: 'later' },
      { at: T, source: 'log', text: 'error  rate up' },
      { at: T, source: 'log', text: 'error rate up' },
      { at: T, source: 'deploy', text: 'deploy x' },
    ]);
    expect(timeline.map((e) => [e.id, e.at, e.source])).toEqual([
      ['E01', T, 'deploy'],
      ['E02', T, 'log'],
      ['E03', t2, 'chat'],
    ]);
  });

  it('keeps events that differ only by source or actor', () => {
    const timeline = buildTimeline([
      { at: T, source: 'chat', actor: 'a', text: 'same' },
      { at: T, source: 'chat', actor: 'b', text: 'same' },
    ]);
    expect(timeline).toHaveLength(2);
  });

  it('pads ids to the width the event count needs', () => {
    const raw = Array.from({ length: 100 }, (_, i) => ({
      at: new Date(MS + i * 1000).toISOString(),
      source: 'log' as const,
      text: `m${i}`,
    }));
    expect(buildTimeline(raw)[99]?.id).toBe('E100');
  });
});

describe('AC-9 blameless authors', () => {
  it('replaces authors with participant-N, case-insensitively, including inside text', () => {
    const timeline = buildTimeline([
      { at: T, source: 'chat', actor: 'Alice', text: 'I think alice broke it; ping BOB' },
      { at: '2026-03-04T14:06:00.000Z', source: 'chat', actor: 'bob', text: 'on it' },
      { at: '2026-03-04T14:07:00.000Z', source: 'deploy', actor: 'ALICE', text: 'deploy by ALICE' },
    ]);
    expect(timeline.map((e) => e.actor)).toEqual([
      'participant-1',
      'participant-2',
      'participant-1',
    ]);
    expect(timeline[0]?.text).toBe('I think participant-1 broke it; ping participant-2');
    expect(JSON.stringify(timeline).toLowerCase()).not.toContain('alice');
  });
});
