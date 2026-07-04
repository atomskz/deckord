import { createCanvas, loadImage, type SKRSContext2D } from '@napi-rs/canvas';
import { DEFAULT_THEME, colorForSeed, initialsOf, type RenderTheme } from '@deckord/renderer';
import type { DeckBadge, DeckBadgeType, RenderedDeckSlot } from '@deckord/shared';
import type { AvatarInput, SlotImageRendererOptions } from './types';

const BADGE_COLORS: Record<DeckBadgeType, string> = {
  'self-mute': '#f23f43',
  'server-mute': '#f23f43',
  'self-deaf': '#f0b232',
  'server-deaf': '#f0b232',
  suppress: '#7a7d84',
  speaking: '#23a55a',
  page: '#5865f2',
};

/**
 * Rasterizes a RenderedDeckSlot into a PNG for physical decks (which need pixels,
 * not CSS). The debug browser deck does NOT use this — it renders the same slot via
 * CSS. A physical deck adapter (Phase 7+) calls this and pushes the bytes to the
 * device. Styling is driven by the shared @deckord/renderer theme.
 */
export class SlotImageRenderer {
  private readonly theme: RenderTheme;
  private readonly size: number;

  constructor(options: SlotImageRendererOptions = {}) {
    this.theme = options.theme ?? DEFAULT_THEME;
    this.size = options.size ?? 96;
  }

  async renderToBuffer(slot: RenderedDeckSlot, avatar?: AvatarInput): Promise<Buffer> {
    const canvas = createCanvas(this.size, this.size);
    const ctx = canvas.getContext('2d');
    await this.draw(ctx, slot, avatar);
    return canvas.toBuffer('image/png');
  }

  async renderToDataUrl(slot: RenderedDeckSlot, avatar?: AvatarInput): Promise<string> {
    const buffer = await this.renderToBuffer(slot, avatar);
    return `data:image/png;base64,${buffer.toString('base64')}`;
  }

  // --- drawing -------------------------------------------------------------

  private async draw(ctx: SKRSContext2D, slot: RenderedDeckSlot, avatar?: AvatarInput): Promise<void> {
    const s = this.size;
    const c = this.theme.colors;

    ctx.fillStyle =
      slot.kind === 'empty'
        ? c.empty
        : slot.kind === 'status' || slot.kind === 'page'
          ? c.status
          : c.slotBackground;
    roundRect(ctx, 0, 0, s, s, s * 0.14);
    ctx.fill();

    if (slot.kind === 'user') await this.drawUser(ctx, slot, avatar);
    else if (slot.kind !== 'empty') this.drawStatus(ctx, slot);

    if (slot.visualState.speaking) this.drawBorder(ctx, c.speaking);
    else if (slot.visualState.selected) this.drawBorder(ctx, c.selected);

    this.drawBadges(ctx, slot.badges ?? []);
  }

  private async drawUser(ctx: SKRSContext2D, slot: RenderedDeckSlot, avatar?: AvatarInput): Promise<void> {
    const s = this.size;
    const cx = s / 2;
    const cy = s * 0.36;
    const r = s * 0.24;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();

    let drewImage = false;
    if (avatar) {
      try {
        const img = await loadImage(avatar);
        ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
        drewImage = true;
      } catch {
        drewImage = false;
      }
    }
    if (!drewImage) {
      ctx.fillStyle = colorForSeed(slot.userId ?? slot.title ?? '');
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }

    // Dim the avatar when muted/deafened (unless actively speaking).
    if ((slot.visualState.muted || slot.visualState.deafened) && !slot.visualState.speaking) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
    ctx.restore();

    if (!drewImage) {
      ctx.fillStyle = '#ffffff';
      ctx.font = `700 ${Math.round(r)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(initialsOf(slot.title ?? '?'), cx, cy);
    }

    this.text(ctx, slot.title ?? '', cx, s * 0.72, this.theme.colors.text, Math.round(s * 0.13));
    if (slot.subtitle) {
      this.text(ctx, slot.subtitle, cx, s * 0.86, this.theme.colors.subtitle, Math.round(s * 0.1));
    }
  }

  private drawStatus(ctx: SKRSContext2D, slot: RenderedDeckSlot): void {
    const s = this.size;
    this.text(ctx, slot.title ?? 'Deckord', s / 2, s * 0.42, this.theme.colors.text, Math.round(s * 0.14));
    if (slot.subtitle) {
      this.text(ctx, slot.subtitle, s / 2, s * 0.6, this.theme.colors.subtitle, Math.round(s * 0.12));
    }
  }

  private drawBorder(ctx: SKRSContext2D, color: string): void {
    const s = this.size;
    const w = Math.max(3, s * 0.04);
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    roundRect(ctx, w / 2, w / 2, s - w, s - w, s * 0.12);
    ctx.stroke();
  }

  private drawBadges(ctx: SKRSContext2D, badges: DeckBadge[]): void {
    const s = this.size;
    const bs = Math.round(s * 0.2);
    let x = s - bs - Math.round(s * 0.05);
    const y = Math.round(s * 0.05);
    const minX = Math.round(s * 0.05);
    for (const badge of badges) {
      if (x < minX) break; // stop before badges overflow off the left edge
      ctx.fillStyle = BADGE_COLORS[badge.type];
      roundRect(ctx, x, y, bs, bs, bs * 0.3);
      ctx.fill();
      ctx.fillStyle = badge.type === 'self-deaf' || badge.type === 'server-deaf' ? '#1e1f22' : '#ffffff';
      ctx.font = `700 ${Math.round(bs * 0.6)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(badge.label, x + bs / 2, y + bs / 2 + 1);
      x -= bs + Math.round(s * 0.03);
    }
  }

  private text(ctx: SKRSContext2D, value: string, x: number, y: number, color: string, fontPx: number): void {
    ctx.fillStyle = color;
    ctx.font = `600 ${fontPx}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(truncate(ctx, value, this.size * 0.9), x, y);
  }
}

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function truncate(ctx: SKRSContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let result = text;
  while (result.length > 1 && ctx.measureText(`${result}…`).width > maxWidth) {
    result = result.slice(0, -1);
  }
  return `${result}…`;
}
