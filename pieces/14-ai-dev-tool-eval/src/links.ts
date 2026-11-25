import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export interface Link {
  target: string;
  line: number;
}

export interface BrokenLink {
  file: string;
  line: number;
  target: string;
  reason: string;
}

/** Resolves to the HTTP status of a URL. Rejects on a network error. */
export type Fetcher = (url: string) => Promise<{ status: number }>;

export interface LinkReport {
  /** Relative and same-file anchor links that were checked against the disk. */
  checked: number;
  /** Every http or https link found, checked live or not. */
  external: number;
  /** External links not checked because live mode was off. */
  skipped: number;
  broken: BrokenLink[];
}

export interface CheckOptions {
  root: string;
  /** Markdown file names, relative to root. */
  files: string[];
  live: boolean;
  /** Required when live is true. Tests pass a fake; the CLI passes a fetch-based one. */
  fetcher?: Fetcher | undefined;
}

const INLINE_LINK = /!?\[[^\]]*\]\(\s*<?([^\s)>]+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;
const REFERENCE_DEF = /^\s{0,3}\[[^\]]+\]:\s*<?(\S+?)>?(?:\s|$)/;
const AUTOLINK = /<(https?:\/\/[^>\s]+)>/g;
const FENCE = /^\s*(```|~~~)/;
const HEADING = /^#{1,6}\s+(.+?)\s*#*\s*$/;

/** Lines outside fenced code blocks, with their 1-based line numbers. */
function proseLines(markdown: string): Array<{ text: string; line: number }> {
  const lines: Array<{ text: string; line: number }> = [];
  let fence: string | null = null;
  markdown.split('\n').forEach((text, index) => {
    const line = index + 1;
    const marker = FENCE.exec(text)?.[1];
    if (fence !== null) {
      if (marker === fence) fence = null;
      return;
    }
    if (marker) {
      fence = marker;
      return;
    }
    lines.push({ text, line });
  });
  return lines;
}

/** Finds inline links, images, reference definitions and autolinks outside code. */
export function extractLinks(markdown: string): Link[] {
  const links: Link[] = [];
  for (const { text, line } of proseLines(markdown)) {
    const visible = text.replace(/`[^`]*`/g, '');
    for (const match of visible.matchAll(INLINE_LINK)) links.push({ target: match[1] ?? '', line });
    const reference = REFERENCE_DEF.exec(visible)?.[1];
    if (reference) links.push({ target: reference, line });
    for (const match of visible.matchAll(AUTOLINK)) links.push({ target: match[1] ?? '', line });
  }
  return links;
}

/** GitHub-style anchor for a heading: lowercase, punctuation removed, spaces become hyphens. */
export function slugify(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

/** The set of anchors a markdown document offers, from its headings outside code. */
export function headingSlugs(markdown: string): Set<string> {
  const slugs = new Set<string>();
  for (const { text } of proseLines(markdown)) {
    const heading = HEADING.exec(text)?.[1];
    if (heading) slugs.add(slugify(heading));
  }
  return slugs;
}

/** Top-level markdown files in a folder, sorted by name. */
export function listMarkdownFiles(root: string): string[] {
  return readdirSync(root)
    .filter((name) => name.endsWith('.md') && statSync(join(root, name)).isFile())
    .sort();
}

type Kind = 'anchor' | 'relative' | 'external' | 'ignored';

function classify(target: string): Kind {
  if (target.startsWith('#')) return 'anchor';
  if (/^https?:\/\//i.test(target)) return 'external';
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) return 'ignored';
  return 'relative';
}

const decode = (text: string): string => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};

/**
 * Checks every link in the given files. Relative links must exist on disk. Anchors must match a
 * heading. External links are only fetched when live is true; otherwise they are counted as
 * skipped. Each unique live URL is fetched once.
 */
export async function checkLinks(options: CheckOptions): Promise<LinkReport> {
  if (options.live && !options.fetcher) throw new Error('live mode needs a fetcher');
  const fetcher = options.fetcher;
  const report: LinkReport = { checked: 0, external: 0, skipped: 0, broken: [] };
  const pending: Array<{ file: string; line: number; url: string }> = [];

  for (const file of options.files) {
    const path = resolve(options.root, file);
    let text: string;
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      report.broken.push({ file, line: 0, target: file, reason: 'cannot read file' });
      continue;
    }
    const ownSlugs = headingSlugs(text);

    for (const link of extractLinks(text)) {
      const kind = classify(link.target);
      const fail = (reason: string) =>
        report.broken.push({ file, line: link.line, target: link.target, reason });

      if (kind === 'anchor') {
        report.checked += 1;
        if (!ownSlugs.has(slugify(decode(link.target.slice(1))))) {
          fail(`no heading matches ${link.target} in this file`);
        }
      } else if (kind === 'relative') {
        report.checked += 1;
        const hash = link.target.indexOf('#');
        const pathPart = hash < 0 ? link.target : link.target.slice(0, hash);
        const fragment = hash < 0 ? '' : link.target.slice(hash + 1);
        const decoded = decode(pathPart);
        const target = resolve(dirname(path), decoded);
        if (!existsSync(target)) {
          fail(`file not found: ${decoded}`);
        } else if (fragment && target.endsWith('.md')) {
          const slugs = headingSlugs(readFileSync(target, 'utf8'));
          if (!slugs.has(slugify(decode(fragment)))) {
            fail(`no heading matches #${fragment} in ${decoded}`);
          }
        }
      } else if (kind === 'external') {
        report.external += 1;
        if (options.live) pending.push({ file, line: link.line, url: link.target });
        else report.skipped += 1;
      }
    }
  }

  if (options.live && fetcher) {
    const results = new Map<string, string | null>();
    for (const url of new Set(pending.map((p) => p.url))) {
      try {
        const response = await fetcher(url);
        results.set(url, response.status >= 400 ? `HTTP ${response.status}` : null);
      } catch (err) {
        results.set(url, err instanceof Error ? err.message : String(err));
      }
    }
    for (const item of pending) {
      const reason = results.get(item.url);
      if (reason) {
        report.broken.push({ file: item.file, line: item.line, target: item.url, reason });
      }
    }
  }

  return report;
}
