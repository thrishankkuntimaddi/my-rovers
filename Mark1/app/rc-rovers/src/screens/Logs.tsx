import { useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { Segmented } from '../components/Controls';
import { useStore } from '../state/store';
import { LOG_CATS, clearLogs, clearTrips, exportLogs, logs, trips, type LogCat } from '../state/logs';
import { academy } from '../state/academy';
import { toast } from '../state/ui';

type View = 'events' | 'trips' | 'stats';
const fmtDur = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor(s / 60) % 60}m` : s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`);

export function Logs() {
  const { items } = useStore(logs);
  const t = useStore(trips);
  const a = useStore(academy);
  const [view, setView] = useState<View>('events');
  const [cats, setCats] = useState<Set<LogCat>>(new Set(LOG_CATS.filter((c) => c.id !== 'telemetry').map((c) => c.id)));
  const [q, setQ] = useState('');
  const shown = useMemo(() => items.filter((l) => cats.has(l.cat) && (!q || l.text.toLowerCase().includes(q.toLowerCase()))).slice(0, 400), [items, cats, q]);
  const toggle = (c: LogCat) => setCats((s) => { const n = new Set(s); if (n.has(c)) n.delete(c); else n.add(c); return n; });
  const doExport = async (f: 'json' | 'csv') => { try { const name = await exportLogs(f); toast(`Exported ${name}`, 'good'); } catch (e) { toast(`Export failed: ${(e as Error).message}`, 'bad'); } };
  const allTrips = t.current ? [t.current, ...t.list] : t.list;
  const tot = allTrips.reduce((acc, x) => ({ d: acc.d + x.distance, s: acc.s + x.seconds, m: acc.m + x.missions, e: acc.e + x.estops }), { d: 0, s: 0, m: 0, e: 0 });

  return (
    <section className="screen tabscreen">
      <header className="lg-header lg-bar page-head">
        <div className="page-title"><Icon name="list" size={20} /><div><b>Logs</b><small>{items.length} events · {allTrips.length} trips</small></div></div>
        <Segmented<View> value={view} onChange={setView} options={[{ id: 'events', label: 'Events' }, { id: 'trips', label: 'Trips' }, { id: 'stats', label: 'Stats' }]} />
      </header>
      <div className="lg-scroll page-scroll">
        <div className="page-inner">
          {view === 'events' && <>
            <div className="log-tools">
              <div className="search lg-field"><Icon name="search" size={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search logs" /></div>
              <button className="lg-btn" onClick={() => doExport('json')}><Icon name="download" size={15} />JSON</button>
              <button className="lg-btn" onClick={() => doExport('csv')}><Icon name="download" size={15} />CSV</button>
              <button className="lg-btn" onClick={() => { clearLogs(); toast('Logs cleared'); }}><Icon name="trash" size={15} />Clear</button>
            </div>
            <div className="cat-row">
              {LOG_CATS.map((c) => <button key={c.id} className={`lg-chip chip-btn cat-${c.id}${cats.has(c.id) ? ' is-on' : ''}`} onClick={() => toggle(c.id)}>{c.label}</button>)}
            </div>
            <div className="lg-tile log-list">
              {shown.length === 0 && <p className="lg-text-3 empty">No events match.</p>}
              {shown.map((l) => (
                <div key={l.id} className={`log-row is-${l.tone}`}>
                  <time>{new Date(l.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
                  <span className={`log-cat cat-${l.cat}`}>{l.cat}</span>
                  <span className="log-text">{l.text}</span>
                </div>
              ))}
            </div>
          </>}
          {view === 'trips' && <>
            <div className="log-tools"><span className="lg-text-2 grow">Every connection is a trip. Distance and speed are estimates.</span>
              <button className="lg-btn" onClick={() => { clearTrips(); toast('Trips cleared'); }}><Icon name="trash" size={15} />Clear</button></div>
            <div className="trip-grid">
              {allTrips.length === 0 && <p className="lg-text-3 empty">No trips yet — go for a drive.</p>}
              {allTrips.map((x) => (
                <div key={x.id} className="lg-tile trip">
                  <div className="trip-head"><b>{new Date(x.start).toLocaleDateString([], { day: 'numeric', month: 'short' })} · {new Date(x.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</b>
                    <span className={`lg-chip${x.end ? '' : ' is-green'}`}>{x.end ? (x.kind === 'demo' ? 'Demo' : x.kind === 'http' ? 'Basic' : 'Rover') : 'Live'}</span></div>
                  <div className="trip-stats">
                    <div><small>Drive time</small><b>{fmtDur(x.seconds)}</b></div>
                    <div><small>Distance</small><b>{x.distance.toFixed(1)} m</b></div>
                    <div><small>Top speed</small><b>{(x.maxSpeed * 3.6).toFixed(1)} km/h</b></div>
                    <div><small>Battery used</small><b>{x.batteryUsed != null ? `${x.batteryUsed}%` : '—'}</b></div>
                    <div><small>Missions</small><b>{x.missions}</b></div>
                    <div><small>E-stops</small><b>{x.estops}</b></div>
                  </div>
                </div>
              ))}
            </div>
          </>}
          {view === 'stats' && (
            <div className="stat-grid">
              {[
                ['Total distance', `${a.c.distance.toFixed(1)} m`, '📏'], ['Drive time', fmtDur(a.c.driveSeconds), '⏱'], ['Sessions', `${a.c.sessions}`, '🛰'],
                ['Top speed', `${(a.c.maxSpeed * 3.6).toFixed(1)} km/h`, '⚡'], ['Voice commands', `${a.c.voiceCmds}`, '🎙'], ['Typed commands', `${a.c.typedCmds}`, '⌨️'],
                ['Missions run', `${a.c.missionsRun}`, '🧭'], ['Missions made', `${a.c.missionsMade}`, '📐'], ['Recordings', `${a.c.recordings}`, '🎬'],
                ['Emergency stops', `${a.c.estops}`, '🛑'], ['Tilt time', fmtDur(a.c.tiltSeconds), '📱'], ['Trips logged', `${allTrips.length} · ${tot.d.toFixed(0)} m`, '🗺'],
              ].map(([k, v, i]) => <div key={k} className="lg-tile stat-tile"><span className="stat-ic">{i}</span><small>{k}</small><b>{v}</b></div>)}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
