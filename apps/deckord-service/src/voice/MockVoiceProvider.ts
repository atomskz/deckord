import type { MockCommand } from '@deckord/ipc-contract';
import { createLogger, type Logger, type VoiceChannelState, type VoiceUser } from '@deckord/shared';
import type { IVoiceProvider, ProviderStatus } from './types';

const MOCK_NAMES: Array<{ display: string; username: string }> = [
  { display: 'Nova', username: 'nova' },
  { display: 'Pixel', username: 'pixel_dev' },
  { display: 'Echo', username: 'echo.wav' },
  { display: 'Juniper', username: 'juni' },
  { display: 'Rook', username: 'rook42' },
  { display: 'Sable', username: 'sable' },
  { display: 'Wren', username: 'wren_b' },
  { display: 'Atlas', username: 'atlas' },
  { display: 'Ivy', username: 'ivy.green' },
  { display: 'Cosmo', username: 'cosmo' },
  { display: 'Quill', username: 'quill' },
  { display: 'Vesper', username: 'vesper' },
];

export type MockOptions = {
  autoStart: boolean;
  initialUsers: number;
  speakingIntervalMs: number;
};

/**
 * Simulates a Discord voice channel so the whole system runs with no Discord
 * client present. Drives speaking/mute/deafen and join/leave either on a timer
 * or via explicit debug commands from the UI.
 */
export class MockVoiceProvider implements IVoiceProvider {
  readonly kind = 'mock' as const;

  private readonly log: Logger;
  private readonly updateHandlers: ((state: VoiceChannelState) => void)[] = [];
  private readonly statusHandlers: ((status: ProviderStatus) => void)[] = [];

  private users: VoiceUser[] = [];
  private nextId = 1;
  private timer: ReturnType<typeof setInterval> | null = null;
  private connected = false;

  constructor(
    private readonly options: MockOptions,
    logger: Logger = createLogger('mock'),
  ) {
    this.log = logger;
  }

  async start(): Promise<void> {
    this.connected = true;
    if (this.users.length === 0) {
      this.seed(this.options.initialUsers);
    }
    if (this.options.autoStart) {
      this.startSpeakingLoop();
    }
    this.status('info', 'Mock provider started');
    this.emit();
  }

  async stop(): Promise<void> {
    this.stopSpeakingLoop();
    for (const user of this.users) user.isSpeaking = false;
    this.emit();
  }

  getState(): VoiceChannelState {
    return this.snapshot();
  }

  onUpdate(handler: (state: VoiceChannelState) => void): void {
    this.updateHandlers.push(handler);
  }

  onStatus(handler: (status: ProviderStatus) => void): void {
    this.statusHandlers.push(handler);
  }

  command(command: MockCommand, userId?: string): void {
    switch (command) {
      case 'start':
        this.connected = true;
        if (this.users.length === 0) this.seed(this.options.initialUsers);
        this.startSpeakingLoop();
        this.status('info', 'Mock simulation started');
        break;
      case 'stop':
        this.stopSpeakingLoop();
        for (const user of this.users) user.isSpeaking = false;
        this.status('info', 'Mock simulation stopped');
        break;
      case 'random_speaking':
        this.randomSpeaking();
        break;
      case 'toggle_mute':
        this.toggleMute(userId);
        break;
      case 'toggle_deafen':
        this.toggleDeafen(userId);
        break;
      case 'add_user':
        this.addUser();
        break;
      case 'remove_user':
        this.removeUser(userId);
        break;
      case 'reset':
        this.reset();
        break;
    }
    this.emit();
  }

  // --- internal ------------------------------------------------------------

  private seed(count: number): void {
    for (let i = 0; i < count; i++) this.addUser(false);
  }

  private addUser(emitStatus = true): void {
    const template = MOCK_NAMES[(this.nextId - 1) % MOCK_NAMES.length]!;
    const suffix = this.nextId > MOCK_NAMES.length ? ` ${Math.ceil(this.nextId / MOCK_NAMES.length)}` : '';
    const user: VoiceUser = {
      userId: `mock-${this.nextId}`,
      username: `${template.username}${suffix ? this.nextId : ''}`,
      displayName: `${template.display}${suffix}`,
      isSpeaking: false,
      selfMute: false,
      serverMute: false,
      selfDeaf: false,
      serverDeaf: false,
      suppress: false,
      volume: 100,
    };
    this.nextId += 1;
    this.users.push(user);
    if (emitStatus) this.status('info', `Added ${user.displayName}`);
  }

  private removeUser(userId?: string): void {
    if (this.users.length === 0) return;
    const target = userId
      ? this.users.find((u) => u.userId === userId)
      : this.users[this.users.length - 1];
    if (!target) return;
    this.users = this.users.filter((u) => u.userId !== target.userId);
    this.status('info', `Removed ${target.displayName}`);
  }

  private reset(): void {
    this.stopSpeakingLoop();
    this.users = [];
    this.nextId = 1;
    this.seed(this.options.initialUsers);
    this.connected = true;
    this.status('info', 'Channel reset');
  }

  private randomSpeaking(): void {
    if (this.users.length === 0) return;
    const target = this.users[Math.floor(Math.random() * this.users.length)]!;
    // A deafened/muted user cannot be speaking.
    if (target.selfMute || target.serverMute || target.selfDeaf || target.serverDeaf) return;
    target.isSpeaking = !target.isSpeaking;
  }

  private toggleMute(userId?: string): void {
    const target = this.pick(userId);
    if (!target) return;
    target.selfMute = !target.selfMute;
    if (target.selfMute) target.isSpeaking = false;
  }

  private toggleDeafen(userId?: string): void {
    const target = this.pick(userId);
    if (!target) return;
    target.selfDeaf = !target.selfDeaf;
    // Deafening also mutes in Discord.
    if (target.selfDeaf) {
      target.selfMute = true;
      target.isSpeaking = false;
    }
  }

  private pick(userId?: string): VoiceUser | undefined {
    if (userId) return this.users.find((u) => u.userId === userId);
    return this.users[Math.floor(Math.random() * this.users.length)];
  }

  private startSpeakingLoop(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tickSpeaking();
      this.emit();
    }, this.options.speakingIntervalMs);
  }

  private stopSpeakingLoop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tickSpeaking(): void {
    const eligible = this.users.filter(
      (u) => !u.selfMute && !u.serverMute && !u.selfDeaf && !u.serverDeaf,
    );
    for (const user of this.users) user.isSpeaking = false;
    if (eligible.length === 0) return;
    const speakers = Math.min(eligible.length, 1 + Math.floor(Math.random() * 2));
    for (let i = 0; i < speakers; i++) {
      const user = eligible[Math.floor(Math.random() * eligible.length)]!;
      user.isSpeaking = true;
    }
  }

  private snapshot(): VoiceChannelState {
    return {
      provider: 'mock',
      connected: this.connected,
      channelId: this.connected ? 'mock-voice-1' : null,
      channelName: this.connected ? 'Mock Lounge' : null,
      guildId: 'mock-guild-1',
      guildName: 'Mock Server',
      users: this.users.map((u) => ({ ...u })),
      updatedAt: Date.now(),
    };
  }

  private emit(): void {
    const state = this.snapshot();
    for (const handler of this.updateHandlers) handler(state);
  }

  private status(level: ProviderStatus['level'], message: string): void {
    this.log.debug(message);
    for (const handler of this.statusHandlers) handler({ level, message });
  }
}
