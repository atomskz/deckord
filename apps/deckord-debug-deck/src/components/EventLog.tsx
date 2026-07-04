import { useEffect, useRef } from 'react';
import type { LogEntry } from '../app/useDeckConnection';

type Props = {
  log: LogEntry[];
};

export function EventLog({ log }: Props) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [log]);

  return (
    <section className="panel panel--log">
      <h2>Event log</h2>
      <div className="log">
        {log.map((entry) => (
          <div key={entry.id} className={`log-line log-${entry.level}`}>
            <span className="log-time">{entry.time}</span>
            <span className="log-msg">{entry.message}</span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </section>
  );
}
