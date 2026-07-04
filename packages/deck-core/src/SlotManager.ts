import {
  EMPTY_VISUAL_STATE,
  isUserDeafened,
  isUserMuted,
  type DeckLayout,
  type DeckSlot,
  type VoiceChannelState,
  type VoiceUser,
} from '@deckord/shared';
import { StableOrderPolicy, type AssignmentPolicy } from './AssignmentPolicy';
import { PageManager } from './PageManager';
import { DEFAULT_SLOT_CONFIG, type SlotManagerConfig } from './types';

/**
 * Turns a VoiceChannelState into a logical DeckLayout with stable slot
 * assignment and pagination. Presentational fields (title, image, badges) are
 * intentionally left empty here — the renderer fills them. deck-core is pure
 * apart from the small amount of UI state it remembers (order, page, selection).
 */
export class SlotManager {
  private readonly config: SlotManagerConfig;
  private readonly policy: AssignmentPolicy;
  private readonly pages: PageManager;
  private readonly userSlotIndices: number[];

  private page = 0;
  private readonly selected = new Set<string>();
  private lastVoice: VoiceChannelState | null = null;

  constructor(config: SlotManagerConfig = DEFAULT_SLOT_CONFIG, policy: AssignmentPolicy = new StableOrderPolicy()) {
    this.config = config;
    this.policy = policy;
    this.userSlotIndices = [];
    for (let i = 0; i < this.slotCount; i++) {
      if (i !== config.statusSlotIndex) this.userSlotIndices.push(i);
    }
    // A deck can have 0 user slots (an OpenDeck with no keys assigned yet, or a lone
    // status slot); PageManager handles perPage === 0 as a single empty page.
    this.pages = new PageManager(this.userSlotIndices.length);
  }

  get slotCount(): number {
    return this.config.rows * this.config.columns;
  }

  /** Number of user slots available per page (total minus the status slot). */
  get userSlotsPerPage(): number {
    return this.userSlotIndices.length;
  }

  get currentPage(): number {
    return this.page;
  }

  /** Compute the layout for the given voice state and remember it. */
  computeLayout(voice: VoiceChannelState): DeckLayout {
    this.lastVoice = voice;

    const orderedIds = this.policy.reconcile(voice.users);
    const userById = new Map(voice.users.map((u) => [u.userId, u] as const));

    const pageCount = this.pages.pageCount(orderedIds.length);
    this.page = this.pages.clamp(this.page, orderedIds.length);
    const pageIds = this.pages.slice(orderedIds, this.page);

    const slots: DeckSlot[] = new Array<DeckSlot>(this.slotCount);

    // Status / page slot.
    slots[this.config.statusSlotIndex] = this.buildStatusSlot(pageCount);

    // User + empty slots.
    this.userSlotIndices.forEach((slotIndex, position) => {
      const userId = pageIds[position];
      const user = userId ? userById.get(userId) : undefined;
      slots[slotIndex] = user ? this.buildUserSlot(slotIndex, user) : this.buildEmptySlot(slotIndex);
    });

    return {
      rows: this.config.rows,
      columns: this.config.columns,
      slotCount: this.slotCount,
      page: this.page,
      pageCount,
      slots,
    };
  }

  /** Recompute using the last known voice state (e.g. after a button toggle). */
  recompute(): DeckLayout {
    return this.computeLayout(this.lastVoice ?? emptyVoiceState());
  }

  nextPage(): DeckLayout {
    const total = this.lastVoice?.users.length ?? 0;
    const pageCount = this.pages.pageCount(total);
    this.page = (this.page + 1) % pageCount;
    return this.recompute();
  }

  setPage(page: number): DeckLayout {
    this.page = page;
    return this.recompute();
  }

  toggleSelected(userId: string): DeckLayout {
    if (this.selected.has(userId)) this.selected.delete(userId);
    else this.selected.add(userId);
    return this.recompute();
  }

  isSelected(userId: string): boolean {
    return this.selected.has(userId);
  }

  /** userId currently occupying a slot, if any (respects the active page). */
  userIdAtSlot(slotIndex: number, layout: DeckLayout): string | undefined {
    return layout.slots[slotIndex]?.userId;
  }

  reset(): void {
    this.policy.reset();
    this.selected.clear();
    this.page = 0;
    this.lastVoice = null;
  }

  private buildUserSlot(slotIndex: number, user: VoiceUser): DeckSlot {
    return {
      slotIndex,
      kind: 'user',
      userId: user.userId,
      visualState: {
        speaking: user.isSpeaking,
        muted: isUserMuted(user),
        deafened: isUserDeafened(user),
        disconnected: false,
        selected: this.selected.has(user.userId),
      },
    };
  }

  private buildEmptySlot(slotIndex: number): DeckSlot {
    return { slotIndex, kind: 'empty', visualState: { ...EMPTY_VISUAL_STATE } };
  }

  private buildStatusSlot(pageCount: number): DeckSlot {
    return {
      slotIndex: this.config.statusSlotIndex,
      kind: pageCount > 1 ? 'page' : 'status',
      visualState: { ...EMPTY_VISUAL_STATE },
    };
  }
}

function emptyVoiceState(): VoiceChannelState {
  return {
    provider: 'mock',
    connected: false,
    channelId: null,
    channelName: null,
    users: [],
    updatedAt: 0,
  };
}
