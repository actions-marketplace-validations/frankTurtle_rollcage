import { describe, expect, it } from 'vitest';
import { lazy, remember } from '../src/lambda/memo.ts';

describe('memo helpers', () => {
  it('lazy builds once', () => {
    let n = 0;
    const get = lazy(() => ++n);
    expect([get(), get()]).toEqual([1, 1]);
  });

  it('remember keeps a success but retries after a failure', async () => {
    let n = 0;
    const load = remember(async () => {
      n += 1;
      if (n === 1) throw new Error('throttled');
      return n;
    });
    await expect(load()).rejects.toThrow('throttled');
    expect(await load()).toBe(2);
    expect(await load()).toBe(2);
  });
});
