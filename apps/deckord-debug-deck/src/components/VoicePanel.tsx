import type { VoiceChannelState } from '@deckord/ipc-contract';

type Props = {
  voice: VoiceChannelState | null;
};

export function VoicePanel({ voice }: Props) {
  return (
    <section className="panel">
      <h2>Voice channel</h2>
      <dl className="kv">
        <dt>Provider</dt>
        <dd>{voice?.provider ?? '—'}</dd>
        <dt>Connected</dt>
        <dd>{voice ? String(voice.connected) : '—'}</dd>
        <dt>Server</dt>
        <dd>{voice?.guildName ?? '—'}</dd>
        <dt>Channel</dt>
        <dd>{voice?.channelName ?? '—'}</dd>
        <dt>Users</dt>
        <dd>{voice?.users.length ?? 0}</dd>
        <dt>Speaking</dt>
        <dd>{voice?.users.filter((u) => u.isSpeaking).length ?? 0}</dd>
      </dl>
    </section>
  );
}
