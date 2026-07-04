import { describe, expect, it } from 'vitest';
import { DeckAdapterRegistry, type DeckAdapterFactory } from './DeckAdapterRegistry';
import type { IDeckAdapter } from './IDeckAdapter';

class FakeFactory implements DeckAdapterFactory {
  createdCount = 0;
  constructor(
    readonly id: string,
    readonly name: string,
    private readonly supported: boolean,
  ) {}
  async isSupported(): Promise<boolean> {
    return this.supported;
  }
  async create(): Promise<IDeckAdapter> {
    this.createdCount += 1;
    return { id: this.id } as unknown as IDeckAdapter;
  }
}

describe('DeckAdapterRegistry', () => {
  it('registers, lists, and gets factories', () => {
    const a = new FakeFactory('a', 'A', true);
    const reg = new DeckAdapterRegistry().register(a);
    expect(reg.list()).toHaveLength(1);
    expect(reg.get('a')).toBe(a);
    expect(reg.get('missing')).toBeUndefined();
  });

  it('selects the preferred factory when it is supported', async () => {
    const a = new FakeFactory('a', 'A', true);
    const b = new FakeFactory('b', 'B', true);
    const reg = new DeckAdapterRegistry().register(a).register(b);
    expect(await reg.select('b')).toBe(b);
  });

  it('falls back to the first supported factory', async () => {
    const a = new FakeFactory('a', 'A', false);
    const b = new FakeFactory('b', 'B', true);
    const reg = new DeckAdapterRegistry().register(a).register(b);
    expect(await reg.select('a')).toBe(b); // preferred but unsupported
    expect(await reg.select('missing')).toBe(b); // unknown preferred
    expect(await reg.select()).toBe(b); // no preference
  });

  it('returns undefined when nothing is supported', async () => {
    const reg = new DeckAdapterRegistry().register(new FakeFactory('a', 'A', false));
    expect(await reg.select()).toBeUndefined();
    expect(await reg.selectAndCreate()).toBeUndefined();
  });

  it('selectAndCreate constructs the selected adapter', async () => {
    const a = new FakeFactory('a', 'A', true);
    const reg = new DeckAdapterRegistry().register(a);
    const selection = await reg.selectAndCreate('a');
    expect(selection?.factory).toBe(a);
    expect(a.createdCount).toBe(1);
  });
});
