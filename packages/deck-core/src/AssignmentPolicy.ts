import type { VoiceUser } from '@deckord/shared';

/**
 * Decides the ORDER in which users occupy slots. The MVP policy keeps order
 * stable by join sequence so speaking/mute changes never make a user jump
 * between slots (a hard requirement — a physical deck relabeling itself while
 * someone talks is unusable).
 *
 * Swapping this out later (sort-by-activity, pinned users, manual assignment)
 * is the extension point for those roadmap features.
 */
export interface AssignmentPolicy {
  /**
   * Reconcile the current user set against remembered order and return the
   * ordered list of userIds. Departed users are dropped; new users are appended
   * in the order the provider reported them.
   */
  reconcile(users: VoiceUser[]): string[];
  reset(): void;
}

export class StableOrderPolicy implements AssignmentPolicy {
  private order: string[] = [];

  reconcile(users: VoiceUser[]): string[] {
    const present = new Set(users.map((u) => u.userId));

    // Drop users who left, preserving the relative order of everyone else.
    this.order = this.order.filter((id) => present.has(id));

    // Append newcomers in provider order.
    const known = new Set(this.order);
    for (const user of users) {
      if (!known.has(user.userId)) {
        this.order.push(user.userId);
        known.add(user.userId);
      }
    }

    return [...this.order];
  }

  reset(): void {
    this.order = [];
  }
}
