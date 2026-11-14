import { Sheet, Sparkline } from '../components/Common';
import { useStore } from '../state/store';
import { rover } from '../rover/controller';
import { modeSpec } from '../rover/protocol';
import { logs } from '../state/logs';

const fmtUp = (s: number) => `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
const KIND = { ws: 'Wi-Fi · WebSocket', http: 'Wi-Fi · basic (Firmware V1)', demo: 'Demo (simulated)' } as const;

function Ring({ pct }: { pct: number | null }) {
  const p = pct ?? 0;
  const tone = pct == null ? 'var(--lg-text-3)' : p <= 15 ? 'var(--lg-red)' : p <= 30 ? 'var(--lg-orange)' : 'var(--lg-green)';
  return (
    <svg viewBox="0 0 120 120" className="ring" aria-hidden="true">
      <circle cx="60" cy="60" r="50" className="ring-track" />
      <circle cx="60" cy="60" r="50" className="ring-val" pathLength={100} style={{ stroke: tone, strokeDashoffset: 100 - p }} />
      <text x="60" y="58" className="ring-num">{pct == null ? '—' : `${pct}%`}</text>
      <text x="60" y="78" className="ring-sub">battery</text>
    </svg>
  );
}

export function TelemetrySheet({ open, onClose }: { open: boolean; onClose(): void }) {
  const r = useStore(rover);
  const { tel, history } = r;
  const { items } = useStore(logs);
  const events = items.filter((l) => l.cat === 'link' || l.cat === 'drive' || l.cat === 'mission').slice(0, 60);
  const recent = history.slice(-120);
  return (
    <Sheet open={open} onClose={onClose} title="Telemetry" wide>
      <div className="tel-grid">
        <div className="lg-tile tel-card tel-battery">
          <Ring pct={tel.pct} />
          <div className="kv-list">
            <div><span>Voltage</span><b>{tel.vbat != null ? `${tel.vbat.toFixed(2)} V` : '—'}</b></div>
            <div><span>Per cell</span><b>{tel.vbat != null ? `${(tel.vbat / 3).toFixed(2)} V` : '—'}</b></div>
            <div><span>Runtime left</span><b>{tel.estMin != null ? `~${tel.estMin} min` : 'Learning…'}</b></div>
            <div><span>Status</span><b className={tel.warn.includes('lowbat') ? 't-orange' : ''}>{tel.vbat == null ? 'No sensor yet' : tel.warn.includes('lowbat') ? 'Low' : 'Good'}</b></div>
          </div>
        </div>
        <div className="lg-tile tel-card">
          <div className="tel-head"><span className="lg-label">Battery voltage · 2 min</span><b>{tel.vbat != null ? `${tel.vbat.toFixed(2)} V` : '—'}</b></div>
          <Sparkline data={recent.map((h) => h.v)} min={9} max={12.6} tone="var(--lg-green)" />
        </div>
        <div className="lg-tile tel-card">
          <div className="tel-head"><span className="lg-label">Signal</span><b>{tel.rssi != null ? `${tel.rssi} dBm` : '—'}</b></div>
          <Sparkline data={recent.map((h) => h.rssi)} min={-90} max={-30} />
        </div>
        <div className="lg-tile tel-card">
          <div className="tel-head"><span className="lg-label">Latency</span><b>{r.latency != null ? `${r.latency} ms` : '—'}</b></div>
          <Sparkline data={recent.map((h) => h.lat)} min={0} max={120} />
        </div>
        <div className="lg-tile tel-card">
          <span className="lg-label">Session</span>
          <div className="kv-list">
            <div><span>Link</span><b>{r.kind ? KIND[r.kind] : 'Not connected'}</b></div>
            <div><span>Firmware</span><b>{r.info?.fw ?? '—'}</b></div>
            <div><span>Uptime</span><b>{fmtUp(tel.up)}</b></div>
            <div><span>Mode</span><b>{modeSpec(tel.mode).label} ({modeSpec(tel.mode).cap}%)</b></div>
            <div><span>Output</span><b>thr {tel.thr} · str {tel.str}</b></div>
          </div>
        </div>
        <div className="lg-tile tel-card tel-log">
          <span className="lg-label">Event log</span>
          <div className="log">
            {events.length === 0 && <p className="lg-text-3">Nothing yet.</p>}
            {events.map((l) => (
              <div key={l.id} className={`log-row is-${l.tone}`}>
                <time>{new Date(l.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
                <span>{l.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Sheet>
  );
}
