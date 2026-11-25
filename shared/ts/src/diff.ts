/**
 * Unified diff of one file as one hunk with three lines of context, in the form `git apply`
 * accepts. `oldText` undefined means the file does not exist, so the diff creates it.
 */
export function unifiedDiff(path: string, oldText: string | undefined, newText: string): string {
  const oldLines = oldText === undefined ? [] : splitLines(oldText);
  const newLines = splitLines(newText);
  let start = 0;
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start])
    start++;
  let endOld = oldLines.length;
  let endNew = newLines.length;
  while (endOld > start && endNew > start && oldLines[endOld - 1] === newLines[endNew - 1]) {
    endOld--;
    endNew--;
  }
  if (endOld === start && endNew === start && oldText !== undefined) return '';

  const ctx = 3;
  const from = Math.max(0, start - ctx);
  const tailOld = Math.min(oldLines.length, endOld + ctx);
  const before = oldLines.slice(from, start).map((l) => ` ${l}`);
  const removed = oldLines.slice(start, endOld).map((l) => `-${l}`);
  const added = newLines.slice(start, endNew).map((l) => `+${l}`);
  const after = oldLines.slice(endOld, tailOld).map((l) => ` ${l}`);
  const oldCount = tailOld - from;
  const newCount = oldCount - (endOld - start) + (endNew - start);
  const range = (first: number, count: number): string =>
    `${count === 0 ? first : first + 1},${count}`;
  const header =
    oldText === undefined
      ? [`diff --git a/${path} b/${path}`, 'new file mode 100644', '--- /dev/null', `+++ b/${path}`]
      : [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`];
  return `${[
    ...header,
    `@@ -${range(from, oldCount)} +${range(from, newCount)} @@`,
    ...before,
    ...removed,
    ...added,
    ...after,
  ].join('\n')}\n`;
}

const splitLines = (text: string): string[] =>
  text === '' ? [] : text.replace(/\n$/, '').split('\n');
