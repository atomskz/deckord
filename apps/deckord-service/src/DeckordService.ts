import {
  DeckAdapterHost,
  DeckAdapterRegistry,
  DebugBrowserDeckFactory,
  type DeckCapabilities,
} from '@deckord/deck-adapter';
import { OpenDeckFactory } from '@deckord/adapter-opendeck';
import { DEFAULT_SLOT_CONFIG, SlotManager } from '@deckord/deck-core';
import { DEFAULT_THEME, renderLayout, toRenderedSlot, type RenderContext } from '@deckord/renderer';
import type { MockCommand } from '@deckord/ipc-contract';
import {
  DeckordError,
  type DeckButtonEvent,
  type DeckLayout,
  type Logger,
  type RenderedDeckSlot,
  type VoiceChannelState,
} from '@deckord/shared';
import type { DeckordConfig } from './config/index';
import { AvatarCache } from './avatars/AvatarCache';
import { OpenDeckWsLink } from './opendeck/OpenDeckWsLink';
import { slotConfigFromCapabilities } from './slotConfig';
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
  private slots: SlotManager;
  private readonly adapters: DeckAdapterRegistry;
  private host: DeckAdapterHost | undefined;
  private readonly avatars: AvatarCache;
  private readonly openDeckLink: OpenDeckWsLink | undefined;

  private renderedLayout: DeckLayout | null = null;
  private reconfigureTimer: ReturnType<typeof setTimeout> | undefined;
  private pendingCaps: DeckCapabilities | undefined;

  /** Avatar bytes for a physical-deck rasterizer (OpenDeck): the cached local file. */
  private readonly resolveDeckAvatar = async (slot: RenderedDeckSlot): Promise<string | undefined> => {
    if (!slot.userId) return undefined;
    const user = this.voice.getState().users.find((u) => u.userId === slot.userId);
    return user ? this.avatars.localPath(user) : undefined;
  };

  constructor(
    private readonly config: DeckordConfig,
    private readonly log: Logger,
  ) {
    this.avatars = new AvatarCache({ dir: config.avatarCacheDir }, log.child('avatars'));
    this.slots = new SlotManager(DEFAULT_SLOT_CONFIG);
    this.ws = new WsServer(config.ws, log.child('ws'));

    const capabilities: DeckCapabilities = {
      rows: DEFAULT_SLOT_CONFIG.rows,
      columns: DEFAULT_SLOT_CONFIG.columns,
      slotCount: DEFAULT_SLOT_CONFIG.rows * DEFAULT_SLOT_CONFIG.columns,
      imageFormats: ['css'],
      hasTextApi: true,
    };
    // Register the available deck adapters; the concrete one is chosen at start().
    this.adapters = new DeckAdapterRegistry().register(
      new DebugBrowserDeckFactory(this.ws, capabilities),
    );

    this.voice = new VoiceService(config, log.child('voice'));

    // OpenDeck (Variant B): a loopback endpoint the relay plugin connects to. Only
    // wired when opted in, so we don't open a port for the debug-only default.
    if (config.openDeck.enabled) {
      this.openDeckLink = new OpenDeckWsLink(config.openDeck, log.child('opendeck'));
      this.adapters.register(
        new OpenDeckFactory(this.openDeckLink, {
          theme: DEFAULT_THEME,
          iconSize: config.openDeck.iconSize,
          resolveAvatar: this.resolveDeckAvatar,
        }),
      );
    }
  }

  async start(): Promise<void> {
    // Select the deck adapter: the debug browser deck by default; physical decks
    // probe for their hardware. Falls back to the first supported factory.
    const selection = await this.adapters.selectAndCreate(this.config.deckAdapter);
    if (!selection) {
      throw new DeckordError('CONFIG_INVALID', 'No supported deck adapter is available');
    }
    this.log.info(`Using deck adapter: ${selection.factory.name} (${selection.factory.id})`);
    const host = new DeckAdapterHost(selection.adapter, toRenderedSlot);
    this.host = host;

    // Configure deck-core from the selected deck's capabilities (grid follows the
    // device), and react to runtime capability changes (hot-plug / re-assignment).
    this.slots = new SlotManager(slotConfigFromCapabilities(selection.adapter.getCapabilities()));
    selection.adapter.onCapabilitiesChanged((caps) => this.reconfigure(caps));

    // Initialize a rendered layout so the first client to connect always gets a
    // valid snapshot, even before the provider has emitted any state.
    const initialState = this.voice.getState();
    this.renderedLayout = renderLayout(
      this.slots.computeLayout(initialState),
      this.renderContext(initialState),
    );

    // Wire handlers before accepting connections / starting the provider.
    // Shared button path for whatever adapter is active (paging/selection); no Discord writes yet.
    host.onButtonDown((event) => this.handleButton(event));
    this.ws.onClientConnect((client) => this.sendSnapshot(client));
    this.ws.onMockCommand((command, userId) => this.handleMockCommand(command, userId));
    this.voice.onUpdate((state) => this.refreshDeck(state));
    this.voice.onStatus((status) => this.broadcastStatus(status));

    await host.start();
    if (this.openDeckLink) {
      // After the adapter is created (so frames aren't missed). The endpoint is
      // opt-in and non-critical: a bind failure must not take down the service.
      try {
        await this.openDeckLink.start();
      } catch (error) {
        this.log.warn(`OpenDeck relay endpoint failed to start (continuing): ${String(error)}`);
      }
    }
    await this.ws.start();
    await this.voice.start();
    this.refreshDeck(this.voice.getState());
    this.log.info('Deckord service started');
  }

  async stop(): Promise<void> {
    if (this.reconfigureTimer) clearTimeout(this.reconfigureTimer);
    await this.voice.stop();
    await this.host?.stop();
    await this.openDeckLink?.stop();
    await this.ws.close();
    this.log.info('Deckord service stopped');
  }

  /**
   * Rebuild deck-core when the deck's capabilities change (hot-plug / re-assignment).
   * Debounced so a burst of willAppear/willDisappear while the user assigns keys
   * coalesces into a single rebuild + repaint instead of one per event.
   */
  private reconfigure(caps: DeckCapabilities): void {
    this.pendingCaps = caps;
    if (this.reconfigureTimer) return;
    this.reconfigureTimer = setTimeout(() => {
      this.reconfigureTimer = undefined;
      const pending = this.pendingCaps;
      this.pendingCaps = undefined;
      if (pending) this.applyReconfigure(pending);
    }, 60);
  }

  private applyReconfigure(caps: DeckCapabilities): void {
    this.log.info(`Deck capabilities changed: ${caps.slotCount} slots (${caps.rows}×${caps.columns})`);
    this.slots = new SlotManager(slotConfigFromCapabilities(caps));
    this.renderedLayout = null;
    void this.host?.reset().catch((error) => this.log.warn(`Deck reset failed: ${String(error)}`));
    this.refreshDeck(this.voice.getState());
  }

  // --- pipeline ------------------------------------------------------------

  private refreshDeck(state: VoiceChannelState): void {
    // Warm the avatar cache in the background (de-duplicated); useful for a future
    // physical deck. The browser still loads avatar URLs directly. Guard the
    // fire-and-forget so a future throw can't become an unhandled rejection.
    for (const user of state.users) {
      void this.avatars.prefetch(user).catch((error) => this.log.warn(`avatar prefetch failed: ${String(error)}`));
    }

    const logical = this.slots.computeLayout(state);
    this.pushLayout(logical, state);
    this.ws.broadcast({ type: 'voice_update', payload: state });
  }

  private pushLayout(logical: DeckLayout, state: VoiceChannelState): void {
    const rendered = renderLayout(logical, this.renderContext(state));
    const prev = this.renderedLayout;
    this.renderedLayout = rendered;
    void this.host
      ?.apply(rendered)
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
