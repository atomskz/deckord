import type { MockCommand } from '@deckord/ipc-contract';
import type { VoiceChannelState, VoiceProviderKind } from '@deckord/shared';

export type ProviderStatus = {
  level: 'info' | 'warning' | 'error';
  message: string;
  code?: string;
};

/**
 * A voice provider emits normalized VoiceChannelState. The mock provider and the
 * Discord RPC provider both implement this, so nothing downstream cares which is
 * active. This is the seam that makes "graceful fallback to mock" possible.
 */
export interface IVoiceProvider {
  readonly kind: VoiceProviderKind;
  start(): Promise<void>;
  stop(): Promise<void>;
  getState(): VoiceChannelState;
  onUpdate(handler: (state: VoiceChannelState) => void): void;
  onStatus(handler: (status: ProviderStatus) => void): void;
  /** Debug/mock commands. Real providers ignore these. */
  command(command: MockCommand, userId?: string): void;
}
