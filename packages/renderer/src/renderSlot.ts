import type {
  DeckBadge,
  DeckLayout,
  DeckSlot,
  RenderedDeckSlot,
  VoiceUser,
} from '@deckord/shared';
import { accessibilityLabelForUser, badgesForUser } from './badges';
import type { RenderContext } from './types';

/**
 * Enrich a logical layout (from deck-core) with presentational fields:
 * titles, avatar image, badges, accessibility labels. Returns a NEW layout;
 * inputs are not mutated.
 */
export function renderLayout(layout: DeckLayout, ctx: RenderContext): DeckLayout {
  return {
    ...layout,
    slots: layout.slots.map((slot) => renderSlot(slot, layout, ctx)),
  };
}

export function renderSlot(slot: DeckSlot, layout: DeckLayout, ctx: RenderContext): DeckSlot {
  switch (slot.kind) {
    case 'user':
      return renderUserSlot(slot, ctx);
    case 'page':
    case 'status':
      return renderStatusSlot(slot, layout, ctx);
    case 'empty':
    default:
      return { ...slot, title: undefined, subtitle: undefined, image: undefined, badges: [] };
  }
}

function renderUserSlot(slot: DeckSlot, ctx: RenderContext): DeckSlot {
  const user = slot.userId ? ctx.users.get(slot.userId) : undefined;
  if (!user) {
    return { ...slot, kind: 'empty', badges: [] };
  }
  const badges: DeckBadge[] = badgesForUser(user);
  return {
    ...slot,
    title: user.displayName,
    subtitle: user.username && user.username !== user.displayName ? `@${user.username}` : undefined,
    image: resolveAvatar(user, ctx),
    badges,
    accessibilityLabel: accessibilityLabelForUser(user),
  };
}

function renderStatusSlot(slot: DeckSlot, layout: DeckLayout, ctx: RenderContext): DeckSlot {
  const appName = ctx.appName ?? 'Deckord';
  if (slot.kind === 'page') {
    return {
      ...slot,
      title: 'Page',
      subtitle: `${layout.page + 1}/${layout.pageCount}`,
      badges: [{ type: 'page', label: `${layout.page + 1}` }],
      accessibilityLabel: `Page ${layout.page + 1} of ${layout.pageCount}. Press to go to next page.`,
    };
  }
  return {
    ...slot,
    title: ctx.channelName ?? appName,
    subtitle: `${ctx.users.size} in voice`,
    badges: [],
    accessibilityLabel: ctx.channelName
      ? `Connected to ${ctx.channelName}, ${ctx.users.size} users`
      : appName,
  };
}

function resolveAvatar(user: VoiceUser, ctx: RenderContext): string | undefined {
  return ctx.resolveAvatar?.(user) ?? user.avatarUrl ?? user.avatarLocalPath;
}

/**
 * Map an enriched DeckSlot to the adapter-facing RenderedDeckSlot. `imageDataUrl`
 * is left undefined for now — Phase 5 will add server-side PNG generation
 * (sharp/canvas) for physical decks. CSS decks use `image`.
 */
export function toRenderedSlot(slot: DeckSlot): RenderedDeckSlot {
  return {
    slotIndex: slot.slotIndex,
    kind: slot.kind,
    userId: slot.userId,
    title: slot.title,
    subtitle: slot.subtitle,
    image: slot.image,
    imageDataUrl: undefined,
    badges: slot.badges ?? [],
    visualState: slot.visualState,
    accessibilityLabel: slot.accessibilityLabel,
  };
}
