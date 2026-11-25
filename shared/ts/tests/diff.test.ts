import { describe, expect, it } from 'vitest';
import { unifiedDiff } from '../src/index.js';

describe('unifiedDiff', () => {
  it('handles identical text and edits in the middle', () => {
    expect(unifiedDiff('a.txt', 'x\n', 'x\n')).toBe('');
    const d = unifiedDiff('a.txt', 'a\nb\nc\nd\ne\nf\ng\nh\n', 'a\nb\nc\nd\nX\ne\nf\ng\nh\n');
    expect(d).toContain('@@ -2,6 +2,7 @@');
    expect(d).toContain('+X');
  });

  it('creates a new file when there is no old text', () => {
    const d = unifiedDiff('n.txt', undefined, 'one\ntwo\n');
    expect(d).toContain('new file mode 100644');
    expect(d).toContain('--- /dev/null');
    expect(d).toContain('@@ -0,0 +1,2 @@');
    expect(d).toContain('+one\n+two\n');
  });
});
