import { describe, it, expect } from 'vitest';
import { PageManager } from './PageManager';

describe('PageManager', () => {
  describe('constructor', () => {
    it('throws when perPage is less than 1', () => {
      expect(() => new PageManager(0)).toThrow(RangeError);
      expect(() => new PageManager(-3)).toThrow(RangeError);
    });

    it('accepts perPage of 1 or greater', () => {
      expect(() => new PageManager(1)).not.toThrow();
      expect(() => new PageManager(10)).not.toThrow();
    });
  });

  describe('pageCount', () => {
    it('returns at least 1 even for 0 items', () => {
      const pm = new PageManager(5);
      expect(pm.pageCount(0)).toBe(1);
    });

    it('ceils partial pages', () => {
      const pm = new PageManager(5);
      expect(pm.pageCount(1)).toBe(1);
      expect(pm.pageCount(5)).toBe(1);
      expect(pm.pageCount(6)).toBe(2);
      expect(pm.pageCount(10)).toBe(2);
      expect(pm.pageCount(11)).toBe(3);
    });

    it('handles exact multiples without an extra page', () => {
      const pm = new PageManager(4);
      expect(pm.pageCount(4)).toBe(1);
      expect(pm.pageCount(8)).toBe(2);
      expect(pm.pageCount(12)).toBe(3);
    });

    it('works with perPage of 1', () => {
      const pm = new PageManager(1);
      expect(pm.pageCount(0)).toBe(1);
      expect(pm.pageCount(3)).toBe(3);
    });
  });

  describe('clamp', () => {
    it('clamps negative pages to 0', () => {
      const pm = new PageManager(5);
      // 12 items -> pages 0,1,2 (last = 2)
      expect(pm.clamp(-1, 12)).toBe(0);
      expect(pm.clamp(-100, 12)).toBe(0);
    });

    it('clamps too-large pages to the last page', () => {
      const pm = new PageManager(5);
      // 12 items -> ceil(12/5) = 3 pages, last index = 2
      expect(pm.clamp(2, 12)).toBe(2);
      expect(pm.clamp(3, 12)).toBe(2);
      expect(pm.clamp(999, 12)).toBe(2);
    });

    it('returns 0 for NaN', () => {
      const pm = new PageManager(5);
      expect(pm.clamp(NaN, 12)).toBe(0);
      expect(pm.clamp(NaN, 0)).toBe(0);
    });

    it('truncates fractional pages before clamping', () => {
      const pm = new PageManager(5);
      // 12 items -> last index = 2
      expect(pm.clamp(1.9, 12)).toBe(1);
      expect(pm.clamp(2.9, 12)).toBe(2);
    });

    it('clamps to 0 when there is a single page', () => {
      const pm = new PageManager(5);
      expect(pm.clamp(0, 0)).toBe(0);
      expect(pm.clamp(5, 0)).toBe(0);
      expect(pm.clamp(1, 3)).toBe(0);
    });

    it('returns valid in-range pages unchanged', () => {
      const pm = new PageManager(5);
      expect(pm.clamp(0, 12)).toBe(0);
      expect(pm.clamp(1, 12)).toBe(1);
    });
  });

  describe('slice', () => {
    const items = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

    it('returns the correct window for each page', () => {
      const pm = new PageManager(5);
      expect(pm.slice(items, 0)).toEqual([0, 1, 2, 3, 4]);
      expect(pm.slice(items, 1)).toEqual([5, 6, 7, 8, 9]);
      expect(pm.slice(items, 2)).toEqual([10, 11]);
    });

    it('clamps too-large page requests to the last window', () => {
      const pm = new PageManager(5);
      expect(pm.slice(items, 99)).toEqual([10, 11]);
    });

    it('clamps negative page requests to the first window', () => {
      const pm = new PageManager(5);
      expect(pm.slice(items, -5)).toEqual([0, 1, 2, 3, 4]);
    });

    it('returns first window for NaN page', () => {
      const pm = new PageManager(5);
      expect(pm.slice(items, NaN)).toEqual([0, 1, 2, 3, 4]);
    });

    it('returns an empty array when there are no items', () => {
      const pm = new PageManager(5);
      expect(pm.slice([], 0)).toEqual([]);
      expect(pm.slice([], 3)).toEqual([]);
    });

    it('works with perPage of 1', () => {
      const pm = new PageManager(1);
      expect(pm.slice(items, 0)).toEqual([0]);
      expect(pm.slice(items, 3)).toEqual([3]);
      expect(pm.slice(items, 11)).toEqual([11]);
    });

    it('handles exact-multiple lengths without an empty trailing window', () => {
      const pm = new PageManager(4);
      const eight = [1, 2, 3, 4, 5, 6, 7, 8];
      expect(pm.slice(eight, 1)).toEqual([5, 6, 7, 8]);
      // requesting beyond the last page clamps back to the last full window
      expect(pm.slice(eight, 2)).toEqual([5, 6, 7, 8]);
    });
  });
});
