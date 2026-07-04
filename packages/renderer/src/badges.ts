import type { DeckBadge, VoiceUser } from '@deckord/shared';

/**
 * Derive the status badges shown on a user's button. Speaking is intentionally
 * NOT a badge — it is represented by the slot's `visualState.speaking` glow.
 * Labels are kept to a single glyph so they render reliably on both the CSS
 * debug deck and (later) tiny physical LCD buttons.
 */
export function badgesForUser(user: VoiceUser): DeckBadge[] {
  const badges: DeckBadge[] = [];

  if (user.serverDeaf) badges.push({ type: 'server-deaf', label: 'D' });
  else if (user.selfDeaf) badges.push({ type: 'self-deaf', label: 'D' });

  // A deafened user is implicitly muted; only show the mute badge on its own.
  if (!user.selfDeaf && !user.serverDeaf) {
    if (user.serverMute) badges.push({ type: 'server-mute', label: 'M' });
    else if (user.selfMute) badges.push({ type: 'self-mute', label: 'M' });
  }

  if (user.suppress) badges.push({ type: 'suppress', label: 'S' });

  return badges;
}

export function accessibilityLabelForUser(user: VoiceUser): string {
  const parts = [user.displayName];
  if (user.isSpeaking) parts.push('speaking');
  if (user.serverDeaf || user.selfDeaf) parts.push('deafened');
  else if (user.serverMute || user.selfMute) parts.push('muted');
  if (user.suppress) parts.push('suppressed');
  return parts.join(', ');
}
