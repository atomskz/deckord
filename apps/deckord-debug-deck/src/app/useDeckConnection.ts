import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ClientToServiceMessage,
  DeckLayout,
  ServiceToClientMessage,
  VoiceChannelState,
} from '@deckord/ipc-contract';
import { DeckSocket, resolveWsUrl, type ConnectionStatus } from '../services/DeckSocket';

export type LogEntry = {
  id: number;
  time: string;
  level: 'info' | 'warning' | 'error';
  message: string;
};

export type DeckConnection = {
  status: ConnectionStatus;
  voice: VoiceChannelState | null;
  deck: DeckLayout | null;
  log: LogEntry[];
  send: (message: ClientToServiceMessage) => void;
};

const MAX_LOG = 250;

export function useDeckConnection(): DeckConnection {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [voice, setVoice] = useState<VoiceChannelState | null>(null);
  const [deck, setDeck] = useState<DeckLayout | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const socketRef = useRef<DeckSocket | null>(null);
  const logId = useRef(0);

  const appendLog = useCallback((level: LogEntry['level'], message: string) => {
    const entry: LogEntry = {
      id: logId.current++,
      time: new Date().toLocaleTimeString(),
      level,
      message,
    };
    setLog((prev) => [...prev, entry].slice(-MAX_LOG));
  }, []);

  useEffect(() => {
    const handleMessage = (message: ServiceToClientMessage) => {
      switch (message.type) {
        case 'snapshot':
          setVoice(message.payload.voice);
          setDeck(message.payload.deck);
          appendLog('info', `Snapshot received (${message.payload.voice.users.length} users)`);
          break;
        case 'voice_update':
          setVoice(message.payload);
          break;
        case 'deck_update':
          setDeck(message.payload);
          break;
        case 'slot_update':
          setDeck((prev) =>
            prev
              ? {
                  ...prev,
                  slots: prev.slots.map((slot) =>
                    slot.slotIndex === message.payload.slotIndex ? message.payload.slot : slot,
                  ),
                }
              : prev,
          );
          break;
        case 'status':
          appendLog(message.payload.level, message.payload.message);
          break;
      }
    };

    const handleStatus = (next: ConnectionStatus) => {
      setStatus(next);
      appendLog(next === 'open' ? 'info' : next === 'closed' ? 'warning' : 'info', `Connection ${next}`);
    };

    const socket = new DeckSocket(resolveWsUrl(), {
      onMessage: handleMessage,
      onStatus: handleStatus,
    });
    socketRef.current = socket;
    socket.connect();

    return () => socket.close();
  }, [appendLog]);

  const send = useCallback((message: ClientToServiceMessage) => {
    socketRef.current?.send(message);
  }, []);

  return { status, voice, deck, log, send };
}
