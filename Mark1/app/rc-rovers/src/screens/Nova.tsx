import { useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { DriveButton, MicButton, NavMenu } from '../components/Futuristic';
import { useStore } from '../state/store';
import { ask, clearChat, nova } from '../ai/copilot';
import { voice } from '../ai/voice';
import { rover } from '../rover/controller';
import { haptic } from '../lib/native';

const SUGGEST = [
  'start engine', 'forward slowly for 2 seconds then turn right', 'reverse 1 meter', 'sport mode', 'do a figure 8',
  'battery?', 'status report', 'record a drive', 'stop recording', 'trim left 3', 'dark mode', 'help',
];
const CAPS = [
  { icon: '🧭', t: 'Drive', d: '“forward fast for 3 s then left”' }, { icon: '🎚', t: 'Modes', d: '“crawl mode”, “turbo”' },
  { icon: '🗺', t: 'Missions', d: '“run the patrol”' }, { icon: '🎬', t: 'Record', d: '“record a drive”' },
  { icon: '🔋', t: 'Status', d: '“battery?”, “how far?”' }, { icon: '⚙️', t: 'Settings', d: '“tilt steering on”' },
];

export function Nova() {
  const n = useStore(nova);
  const v = useStore(voice);
  const r = useStore(rover);
  const [text, setText] = useState('');
  const [hist, setHist] = useState<string[]>([]);
  const [hi, setHi] = useState(-1);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' }); }, [n.messages.length, v.partial]);

  const send = (t = text) => {
    const q = t.trim(); if (!q) return;
    ask(q, 'typed'); haptic('light');
    setHist((h) => [q, ...h.filter((x) => x !== q)].slice(0, 30)); setHi(-1); setText('');
  };
  const live = r.status === 'connected';

  return (
    <section className="screen tabscreen nova">
      <header className="lg-header lg-bar page-head">
        <NavMenu />
        <span className="head-status lg-chip">{live ? <><i className="dot is-green-dot" />{r.info?.name ?? 'MARK 1'}{r.kind === 'demo' ? ' · demo' : ''}</> : 'No rover'}</span>
        <div className="head-actions">
          <button className="lg-icon-btn" onClick={clearChat} aria-label="Clear chat"><Icon name="trash" size={17} /></button>
          <DriveButton />
        </div>
      </header>
      <div className="lg-scroll page-scroll chat-scroll" ref={list}>
        <div className="page-inner chat">
          {n.messages.length < 3 && (
            <div className="caps">
              {CAPS.map((c) => <div key={c.t} className="lg-tile cap"><span>{c.icon}</span><b>{c.t}</b><small>{c.d}</small></div>)}
            </div>
          )}
          {n.messages.map((m) => (
            <div key={m.id} className={`msg is-${m.from}${m.tone ? ` tone-${m.tone}` : ''}${m.source === 'tip' ? ' is-tip' : ''}`}>
              {m.from === 'nova' && <span className="nova-orb sm" />}
              <div className="bubble">
                {m.source === 'voice' && <Icon name="mic" size={13} />}{m.text}
                <time>{new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
              </div>
            </div>
          ))}
          {(v.listening || v.partial) && <div className="msg is-you is-live"><div className="bubble"><Icon name="mic" size={13} />{v.partial || 'Listening…'}</div></div>}
        </div>
      </div>
      <div className="composer">
        <div className="chips-row">{SUGGEST.map((s) => <button key={s} className="lg-chip chip-btn" onClick={() => send(s)}>{s}</button>)}</div>
        <div className="composer-bar lg-bar">
          <input className="composer-input" value={text} placeholder="Tell Nova what to do…" enterKeyHint="send" spellCheck={false}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') send();
              if (e.key === 'ArrowUp' && hist.length) { const i = Math.min(hist.length - 1, hi + 1); setHi(i); setText(hist[i]); e.preventDefault(); }
              if (e.key === 'ArrowDown') { const i = hi - 1; setHi(i); setText(i >= 0 ? hist[i] : ''); e.preventDefault(); }
            }} />
          <button className="lg-icon-btn send" onClick={() => send()} disabled={!text.trim()} aria-label="Send"><Icon name="send" size={18} /></button>
          <MicButton />
        </div>
      </div>
    </section>
  );
}
