// Unit tests for the pure photo-cache eviction selection (extracted from photoCache.ts).
const { isUriProtected, selectEvictions } = require('../src/lib/photoCacheLogic');

const MAX = 150 * 1024 * 1024; // 150 MB

function file(name: string, mod: number, size: number, exists = true) {
  return { name, uri: `file:///docs/${name}`, mod, size, exists };
}

describe('isUriProtected', () => {
  const prot = new Set(['file:///docs/pending-a.jpg', 'file:///docs/invoice.pdf']);

  it('matches exact URIs', () => {
    expect(isUriProtected('file:///docs/pending-a.jpg', 'pending-a.jpg', prot)).toBe(true);
  });
  it('matches by /name suffix (uri variants)', () => {
    expect(isUriProtected('file:///other/path/pending-a.jpg', 'pending-a.jpg', prot)).toBe(true);
  });
  it('does not protect unrelated files', () => {
    expect(isUriProtected('file:///docs/other.jpg', 'other.jpg', prot)).toBe(false);
    expect(isUriProtected('file:///docs/pending-a.jpgx', 'pending-a.jpgx', prot)).toBe(false);
  });
  it('handles empty protection set', () => {
    expect(isUriProtected('file:///docs/x.jpg', 'x.jpg', new Set())).toBe(false);
  });
});

describe('selectEvictions', () => {
  const none = new Set<string>();
  const MB = 1024 * 1024;

  it('evicts oldest-first until below the 70% target', () => {
    const files = [file('newest.jpg', 300, 10 * MB), file('oldest.jpg', 100, 40 * MB), file('mid.jpg', 200, 40 * MB)];
    // 160 MB used, target 105 MB → free oldest (120 left) → free mid (80 < 105) stop
    const out = selectEvictions(files, none, 160 * MB, MAX);
    expect(out).toEqual(['file:///docs/oldest.jpg', 'file:///docs/mid.jpg']);
  });

  it('stops as soon as the target is reached', () => {
    const files = [file('a.jpg', 1, 60 * MB), file('b.jpg', 2, 60 * MB), file('c.jpg', 3, 60 * MB)];
    // 170 MB → target 105: free a (110 ≥ 105) → free b (50 < 105) stop → 2 files
    const out = selectEvictions(files, none, 170 * MB, MAX);
    expect(out).toEqual(['file:///docs/a.jpg', 'file:///docs/b.jpg']);
  });

  it('never selects protected (un-uploaded) files', () => {
    const files = [file('keep-me.jpg', 1, 100 * MB), file('evict-me.jpg', 2, 100 * MB)];
    const prot = new Set(['file:///docs/keep-me.jpg']);
    const out = selectEvictions(files, prot, 200 * MB, MAX);
    expect(out).toEqual(['file:///docs/evict-me.jpg']);
  });

  it('skips missing files but continues with the rest', () => {
    const files = [file('gone.jpg', 1, 100 * MB, false), file('real.jpg', 2, 100 * MB)];
    const out = selectEvictions(files, none, 200 * MB, MAX);
    expect(out).toEqual(['file:///docs/real.jpg']);
  });

  it('returns nothing when already under the target', () => {
    const files = [file('a.jpg', 1, 100 * MB)];
    const out = selectEvictions(files, none, 100 * MB, MAX); // 100 < 105 target
    expect(out).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const files = [file('b.jpg', 2, 10), file('a.jpg', 1, 10)];
    const before = [...files];
    selectEvictions(files, none, 200 * MB, MAX);
    expect(files).toEqual(before);
  });
});
