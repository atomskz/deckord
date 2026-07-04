/**
 * Pure pagination helper. Given a per-page capacity it computes page counts,
 * clamps a requested page into range, and slices the ordered item list.
 */
export class PageManager {
  constructor(private readonly perPage: number) {
    if (perPage < 0) throw new RangeError('PageManager perPage must be >= 0');
  }

  pageCount(totalItems: number): number {
    if (this.perPage <= 0) return 1; // no per-page capacity → a single (empty) page
    return Math.max(1, Math.ceil(totalItems / this.perPage));
  }

  clamp(page: number, totalItems: number): number {
    const last = this.pageCount(totalItems) - 1;
    if (Number.isNaN(page)) return 0;
    return Math.min(Math.max(0, Math.trunc(page)), last);
  }

  slice<T>(items: T[], page: number): T[] {
    if (this.perPage <= 0) return [];
    const clamped = this.clamp(page, items.length);
    const start = clamped * this.perPage;
    return items.slice(start, start + this.perPage);
  }
}
