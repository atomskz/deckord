/**
 * Deterministic placeholder faces for users without an avatar.
 *
 * `identiconDataUrl` returns a self-contained SVG data URL — browser-safe (no node
 * deps), usable directly as an `<img src>`. The canvas image-renderer reuses
 * `initialsOf` / `colorForSeed` to draw the same face onto a physical-deck button.
 */

export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

/** Stable HSL color derived from a seed string (same hashing as the debug UI). */
export function colorForSeed(seed: string, saturation = 45, lightness = 38): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) & 0xffffff;
  const hue = hash % 360;
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

export type IdenticonOptions = {
  size?: number;
  /** Seed for the color; defaults to the label. */
  seed?: string;
  textColor?: string;
};

export function identiconDataUrl(label: string, options: IdenticonOptions = {}): string {
  const size = options.size ?? 96;
  const seed = options.seed ?? label;
  const bg = colorForSeed(seed);
  const initials = initialsOf(label);
  const textColor = options.textColor ?? '#ffffff';
  const fontSize = Math.round(size * 0.4);
  const radius = Math.round(size * 0.5);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<rect width="${size}" height="${size}" rx="${radius}" fill="${bg}"/>` +
    `<text x="50%" y="50%" dy=".35em" text-anchor="middle" ` +
    `font-family="system-ui,-apple-system,'Segoe UI',sans-serif" font-size="${fontSize}" ` +
    `font-weight="700" fill="${escapeXml(textColor)}">${escapeXml(initials)}</text>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c === "'" ? '&apos;' : '&quot;',
  );
}
