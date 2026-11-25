import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checkLinks,
  extractLinks,
  headingSlugs,
  listMarkdownFiles,
  slugify,
} from '../src/links.ts';
import { PIECE_ROOT, tmpDir } from './helpers.ts';

describe('AC9: link extraction', () => {
  it('finds inline links, images, reference definitions and autolinks with line numbers', () => {
    const md = [
      '# Title',
      'See [one](a.md) and [two](b.md "a title").',
      '![pic](img/p.png)',
      '[ref]: c.md',
      'Autolink <https://example.test/auto>.',
    ].join('\n');
    expect(extractLinks(md)).toEqual([
      { target: 'a.md', line: 2 },
      { target: 'b.md', line: 2 },
      { target: 'img/p.png', line: 3 },
      { target: 'c.md', line: 4 },
      { target: 'https://example.test/auto', line: 5 },
    ]);
  });

  it('ignores links inside fenced code and inline code', () => {
    const md = [
      'Real [yes](real.md).',
      '```',
      '[fenced](fenced.md)',
      '```',
      'Code `[inline](inline.md)` here.',
      '~~~',
      '[tilde](tilde.md)',
      '~~~',
    ].join('\n');
    expect(extractLinks(md).map((l) => l.target)).toEqual(['real.md']);
  });
});

describe('AC9: slugs and headings', () => {
  it('slugifies headings the way GitHub anchors do, for ordinary text', () => {
    expect(slugify('Acceptance criteria (each has a test)')).toBe(
      'acceptance-criteria-each-has-a-test',
    );
    expect(slugify('  Mixed Case_Ok ')).toBe('mixed-case_ok');
  });

  it('collects heading slugs and skips headings inside code fences', () => {
    const md = ['# Top', '```', '# not a heading', '```', '## Second Part'].join('\n');
    expect([...headingSlugs(md)].sort()).toEqual(['second-part', 'top']);
  });
});

describe('AC9: offline checks', () => {
  function fixture(files: Record<string, string>): string {
    const dir = tmpDir();
    for (const [name, text] of Object.entries(files)) {
      const path = join(dir, name);
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, text);
    }
    return dir;
  }

  it('fails relative links to missing files or missing anchors, and passes the good ones', async () => {
    const root = fixture({
      'a.md': [
        '# Intro',
        '[ok](b.md)',
        '[missing](nope.md)',
        '[same ok](#intro)',
        '[same bad](#nope)',
        '[frag ok](b.md#hello)',
        '[frag bad](b.md#bye)',
        '[dir](sub/)',
        '[mail](mailto:someone@example.test)',
        '[ext](https://example.test/x)',
      ].join('\n'),
      'b.md': '## Hello\n',
      'sub/readme.md': 'x',
    });
    const report = await checkLinks({ root, files: ['a.md'], live: false });
    expect(report.checked).toBe(7);
    expect(report.external).toBe(1);
    expect(report.skipped).toBe(1);
    expect(report.broken.map((b) => b.target)).toEqual(['nope.md', '#nope', 'b.md#bye']);
    expect(report.broken[0]?.reason).toMatch(/file not found/);
    expect(report.broken[1]?.reason).toMatch(/no heading/);
  });

  it('reports a link that resolves outside the folder if the target is missing', async () => {
    const root = fixture({ 'a.md': '[up](../nowhere.md)\n' });
    const report = await checkLinks({ root, files: ['a.md'], live: false });
    expect(report.broken).toHaveLength(1);
    expect(report.broken[0]?.target).toBe('../nowhere.md');
  });

  it('lists only top-level markdown files, sorted', () => {
    const root = fixture({ 'b.md': '', 'a.md': '', 'c.txt': '', 'sub/d.md': '' });
    expect(listMarkdownFiles(root)).toEqual(['a.md', 'b.md']);
  });

  it('treats an unreadable file as a broken link', async () => {
    const root = fixture({});
    const report = await checkLinks({ root, files: ['absent.md'], live: false });
    expect(report.broken).toHaveLength(1);
    expect(report.broken[0]?.reason).toMatch(/cannot read/);
  });
});

describe('AC9: live external checks', () => {
  it('calls the fetcher once per unique URL, and reports bad statuses and errors', async () => {
    const root = tmpDir();
    writeFileSync(
      join(root, 'a.md'),
      [
        '[ok](https://example.test/ok)',
        '[again](https://example.test/ok)',
        '[404](https://example.test/gone)',
        '[boom](https://example.test/boom)',
      ].join('\n'),
    );
    const calls: string[] = [];
    const fetcher = async (url: string) => {
      calls.push(url);
      if (url.endsWith('/boom')) throw new Error('connection reset');
      return { status: url.endsWith('/gone') ? 404 : 200 };
    };
    const report = await checkLinks({ root, files: ['a.md'], live: true, fetcher });
    expect(calls).toEqual([
      'https://example.test/ok',
      'https://example.test/gone',
      'https://example.test/boom',
    ]);
    expect(report.external).toBe(4);
    expect(report.skipped).toBe(0);
    expect(report.broken.map((b) => b.reason)).toEqual(['HTTP 404', 'connection reset']);
  });

  it('refuses live mode without a fetcher, so no default network call is made', async () => {
    await expect(
      checkLinks({ root: PIECE_ROOT, files: ['README.md'], live: true }),
    ).rejects.toThrow(/fetcher/);
  });
});
