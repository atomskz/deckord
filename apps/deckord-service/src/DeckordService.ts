import { DebugBrowserDeckAdapter, DeckAdapterHost } from '@deckord/deck-adapter';
import { DEFAULT_SLOT_CONFIG, SlotManager } from '@deckord/deck-core';
import { DEFAULT_THEME, renderLayout, toRenderedSlot, type RenderContext } from '@deckord/renderer';
import type { MockCommand } from '@deckord/ipc-contract';
import type {
  DeckButtonEvent,
  DeckLayout,
  DeckLayoutSpec,
  Logger,
  VoiceChannelState,
} from '@deckord/shared';
import type { DeckordConfig } from './config/index';
import { AvatarCache } from './avatars/AvatarCache';
import { WsServer, type WsClient } from './server/WsServer';
import { VoiceService } from './voice/VoiceService';
import type { ProviderStatus } from './voice/types';

/**
 * The orchestrator. Owns the pipeline:
 *
 *   VoiceService → SlotManager (deck-core) → renderer → DeckAdapterHost → WsServer
 *
 * It is the ONLY place that knows all the parts exist. Swapping the debug adapter
 * for a physical one is a change here and nowhere else.
 */
export class DeckordService {
  private readonly voice: VoiceService;
  private readonly ws: WsServer;
  private readonly slots: SlotManager;
  private readonly host: DeckAdapterHost;
  private readonly avatars: AvatarCache;

  private renderedLayout: DeckLayout | null = null;

  constructor(
    private readonly config: DeckordConfig,
    private readonly log: Logger,
  ) {
    this.avatars = new AvatarCache(log.child('avatars'));
    this.slots = new SlotManager(DEFAULT_SLOT_CONFIG);
    this.ws = new WsServer(config.ws, log.child('ws'));

    const spec: DeckLayoutSpec = {
      rows: DEFAULT_SLOT_CONFIG.rows,
      columns: DEFAULT_SLOT_CONFIG.columns,
      slotCount: DEFAULT_SLOT_CONFIG.rows * DEFAULT_SLOT_CONFIG.columns,
    };
    const adapter = new DebugBrowserDeckAdapter(this.ws, spec);
    this.host = new DeckAdapterHost(adapter, toRenderedSlot);

    this.voice = new VoiceService(config, log.child('voice'));
  }

  async start(): Promise<void> {
    // Initialize a rendered layout so the first client to connect always gets a
    // valid snapshot, even before the provider has emitted any state.
    const initialState = this.voice.getState();
    this.renderedLayout = renderLayout(
      this.slots.computeLayout(initialState),
      this.renderContext(initialState),
    );

    // Wire handlers before accepting connections / starting the provider.
    this.host.onButtonDown((event) => this.handleButton(event)); // debug only, no Discord writes
    this.ws.onClientConnect((client) => this.sendSnapshot(client));
    this.ws.onMockCommand((command, userId) => this.handleMockCommand(command, userId));
    this.voice.onUpdate((state) => this.refreshDeck(state));
    this.voice.onStatus((status) => this.broadcastStatus(status));

    await this.host.start();
    await this.ws.start();
    await this.voice.start();
    this.refreshDeck(this.voice.getState());
    this.log.info('Deckord service started');
  }

  async stop(): Promise<void> {
    await this.voice.stop();
    await this.host.stop();
    await this.ws.close();
    this.log.info('Deckord service stopped');
  }

  // --- pipeline ------------------------------------------------------------

  private refreshDeck(state: VoiceChannelState): void {
    const logical = this.slots.computeLayout(state);
    this.pushLayout(logical, state);
    this.ws.broadcast({ type: 'voice_update', payload: state });
  }

  private pushLayout(logical: DeckLayout, state: VoiceChannelState): void {
    const rendered = renderLayout(logical, this.renderContext(state));
    const prev = this.renderedLayout;
    this.renderedLayout = rendered;
    void this.host
      .apply(rendered)
      .catch((error) => this.log.warn(`Deck apply failed: ${String(error)}`));
    // Per-slot content streams via slot_update; broadcast a full deck_update on
    // structural changes so the client's layout metadata (page/pageCount) stays correct.
    if (!prev || prev.page !== rendered.page || prev.pageCount !== rendered.pageCount) {
      this.ws.broadcast({ type: 'deck_update', payload: rendered });
    }
  }

  private renderContext(state: VoiceChannelState): RenderContext {
    return {
      users: new Map(state.users.map((u) => [u.userId, u])),
      theme: DEFAULT_THEME,
      resolveAvatar: this.avatars.resolve,
      channelName: state.channelName,
      appName: this.config.appName,
    };
  }

  private sendSnapshot(client: WsClient): void {
    const state = this.voice.getState();
    const deck = this.renderedLayout ?? renderLayout(this.slots.computeLayout(state), this.renderContext(state));
    client.send({ type: 'snapshot', payload: { voice: state, deck } });
  }

  // --- debug interactions --------------------------------------------------

  private handleButton(event: DeckButtonEvent): void {
    const layout = this.renderedLayout;
    if (!layout) return;
    const slot = layout.slots[event.slotIndex];
    if (!slot) return;

    if (slot.kind === 'page' || slot.kind === 'status') {
      const next = this.slots.nextPage();
      this.pushLayout(next, this.voice.getState());
      this.status('info', `Switched to page ${next.page + 1}/${next.pageCount}`);
    } else if (slot.kind === 'user' && slot.userId) {
      const next = this.slots.toggleSelected(slot.userId);
      this.pushLayout(next, this.voice.getState());
      const selected = this.slots.isSelected(slot.userId);
      this.status('info', `${selected ? 'Selected' : 'Deselected'} ${slot.title ?? slot.userId}`);
    }
  }

  private handleMockCommand(command: MockCommand, userId?: string): void {
    this.voice.command(command, userId);
    this.status('info', `Mock: ${command}${userId ? ` (${userId})` : ''}`);
  }

  private broadcastStatus(status: ProviderStatus): void {
    this.ws.broadcast({
      type: 'status',
      payload: { level: status.level, message: status.message, code: status.code },
    });
  }

  private status(level: ProviderStatus['level'], message: string): void {
    this.ws.broadcast({ type: 'status', payload: { level, message } });
  }
}
