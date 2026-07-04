import { describe, expect, it } from 'vitest';
import { colorForSeed, identiconDataUrl, initialsOf } from './identicon';

describe('initialsOf', () => {
  it('takes the first letter of the first two words', () => {
    expect(initialsOf('Nova Star')).toBe('NS');
    expect(initialsOf('  ivy   green  ')).toBe('IG');
  });
  it('takes two letters of a single word', () => {
    expect(initialsOf('nova')).toBe('NO');
  });
  it('falls back to ? for empty input', () => {
    expect(initialsOf('   ')).toBe('?');
  });
});

describe('colorForSeed', () => {
  it('is deterministic for the same seed', () => {
    expect(colorForSeed('user-1')).toBe(colorForSeed('user-1'));
  });
  it('returns an hsl color', () => {
    expect(colorForSeed('abc')).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/);
  });
});

describe('identiconDataUrl', () => {
  it('produces an svg data url containing the initials', () => {
    const url = identiconDataUrl('Nova Star');
    expect(url.startsWith('data:image/svg+xml,')).toBe(true);
    expect(decodeURIComponent(url)).toContain('>NS<');
    expect(decodeURIComponent(url)).toContain('<svg');
  });
  it('respects a custom size', () => {
    const url = decodeURIComponent(identiconDataUrl('X', { size: 128 }));
    expect(url).toContain('width="128"');
  });
});
