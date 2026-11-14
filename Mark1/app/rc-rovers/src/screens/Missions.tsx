import { useMemo, useState } from 'react';
import { Sheet, Slider } from '../components/Common';
import { Icon } from '../components/Icon';
import { PathPreview } from '../components/Futuristic';
import { useStore } from '../state/store';
import { toast } from '../state/ui';
import { haptic } from '../lib/native';
import { control, rover } from '../rover/controller';
import { MODES, type DriveMode } from '../rover/protocol';
import {
  BUILTIN, MOVES, deleteMission, missionMs, missionPath, missions, runMission, saveMission, sid,
  type Mission, type Move, type Step,
} from '../missions/missions';

function useRun(onDrive: () => void) {
  const r = useStore(rover);
  return (m: Mission) => {
    if (r.status !== 'connected') { toast('Connect to MARK 1 or start the demo first', 'warn'); return; }
    const go = () => { const res = runMission(m); if (!res.ok) toast(res.reason!, 'warn'); else onDrive(); };
    if (!r.tel.armed) { control.arm(); haptic('success'); setTimeout(go, 400); } else go();
  };
}

function MissionCard({ m, onRun, onEdit, onCopy, onDelete }: { m: Mission; onRun(): void; onEdit?(): void; onCopy(): void; onDelete?(): void }) {
  const pts = useMemo(() => missionPath(m), [m]);
  return (
    <article className="lg-tile mission">
      <PathPreview pts={pts} />
      <div className="mission-body">
        <div className="mission-title"><span className="mission-icon">{m.icon}</span><b>{m.name}</b>{m.recorded && <span className="lg-chip is-red">REC</span>}</div>
        <p className="lg-text-2">{m.desc}</p>
        <p className="mission-meta">{m.steps.length} step{m.steps.length === 1 ? '' : 's'} · {(missionMs(m) / 1000).toFixed(1)} s</p>
        <div className="mission-actions">
          <button className="lg-btn is-primary" onClick={onRun}><Icon name="play" size={15} />Run</button>
          {onEdit && <button className="lg-icon-btn" onClick={onEdit} aria-label="Edit"><Icon name="edit" size={17} /></button>}
          <button className="lg-icon-btn" onClick={onCopy} aria-label="Duplicate"><Icon name="copy" size={17} /></button>
          {onDelete && <button className="lg-icon-btn" onClick={onDelete} aria-label="Delete"><Icon name="trash" size={17} /></button>}
        </div>
      </div>
    </article>
  );
}

export function Missions({ onDrive }: { onDrive(): void }) {
  const { custom } = useStore(missions);
  const [editing, setEditing] = useState<Mission | null>(null);
  const run = useRun(onDrive);
  const blank = (): Mission => ({ id: sid(), name: 'My mission', icon: '✦', desc: 'Custom route', createdAt: Date.now(),
    steps: [{ id: sid(), kind: 'move', move: 'forward', speed: 50, ms: 1500 }, { id: sid(), kind: 'move', move: 'right', speed: 50, ms: 1000 }] });
  const copy = (m: Mission) => setEditing({ ...m, id: sid(), name: `${m.name} copy`, builtin: false, recorded: m.recorded, createdAt: Date.now(), steps: m.steps.map((s) => ({ ...s, id: sid() })) });

  return (
    <section className="screen tabscreen">
      <header className="lg-header lg-bar page-head">
        <div className="page-title"><Icon name="route" size={20} /><div><b>Missions</b><small>Program routes · record & replay</small></div></div>
        <button className="lg-btn is-primary" onClick={() => setEditing(blank())}><Icon name="plus" size={16} />New</button>
      </header>
      <div className="lg-scroll page-scroll">
        <div className="page-inner">
          <div className="lg-tile intro">
            <div>
              <h2>Autopilot routes</h2>
              <p className="lg-text-2">Build a route from moves, or record yourself driving in the cockpit (● button) and replay it. Touch any control during a run to take over instantly.</p>
            </div>
          </div>
          {custom.length > 0 && <>
            <h3 className="section-title">Yours</h3>
            <div className="mission-grid">
              {custom.map((m) => <MissionCard key={m.id} m={m} onRun={() => run(m)} onEdit={() => setEditing(m)} onCopy={() => copy(m)}
                onDelete={() => { deleteMission(m.id); toast(`Deleted “${m.name}”`); }} />)}
            </div>
          </>}
          <h3 className="section-title">Built-in</h3>
          <div className="mission-grid">
            {BUILTIN.map((m) => <MissionCard key={m.id} m={m} onRun={() => run(m)} onCopy={() => copy(m)} />)}
          </div>
        </div>
      </div>
      {editing && <MissionEditor mission={editing} onClose={() => setEditing(null)} onRun={(m) => { saveMission(m); setEditing(null); run(m); }} />}
    </section>
  );
}

function MissionEditor({ mission, onClose, onRun }: { mission: Mission; onClose(): void; onRun(m: Mission): void }) {
  const [m, setM] = useState<Mission>(mission);
  const [open, setOpen] = useState(true);
  const close = () => { setOpen(false); setTimeout(onClose, 380); };
  const pts = useMemo(() => missionPath(m), [m]);
  const upd = (id: string, patch: Partial<Step>) => setM((x) => ({ ...x, steps: x.steps.map((s) => (s.id === id ? ({ ...s, ...patch } as Step) : s)) }));
  const move = (i: number, d: number) => setM((x) => { const a = [...x.steps]; const j = i + d; if (j < 0 || j >= a.length) return x; [a[i], a[j]] = [a[j], a[i]]; return { ...x, steps: a }; });
  const del = (id: string) => setM((x) => ({ ...x, steps: x.steps.filter((s) => s.id !== id) }));
  const add = (s: Step) => { setM((x) => ({ ...x, steps: [...x.steps, s] })); haptic('tick'); };
  const save = () => { if (!m.name.trim()) return toast('Give it a name', 'warn'); saveMission({ ...m, name: m.name.trim() }); haptic('success'); close(); };

  return (
    <Sheet open={open} onClose={close} title={missions.get().custom.some((x) => x.id === mission.id) ? 'Edit mission' : 'New mission'} wide>
      <div className="editor">
        <div className="editor-main">
          <div className="editor-name">
            <input className="lg-field" value={m.name} maxLength={40} onChange={(e) => setM({ ...m, name: e.target.value })} aria-label="Mission name" />
            <input className="lg-field icon-field" value={m.icon} maxLength={2} onChange={(e) => setM({ ...m, icon: e.target.value || '✦' })} aria-label="Icon" />
          </div>
          <div className="steps-edit">
            {m.steps.map((s, i) => (
              <div key={s.id} className="step-row lg-tile">
                <span className="step-n">{i + 1}</span>
                {s.kind === 'move' && <>
                  <select className="lg-field step-sel" value={s.move} onChange={(e) => upd(s.id, { move: e.target.value as Move })}>
                    {MOVES.map((mv) => <option key={mv.id} value={mv.id}>{mv.glyph} {mv.label}</option>)}
                  </select>
                  {s.move !== 'wait' && <label className="step-ctl"><span>Speed</span><Slider label="Speed" value={s.speed} min={10} max={100} step={5} onChange={(v) => upd(s.id, { speed: v })} format={(v) => `${v}%`} /></label>}
                  <label className="step-ctl"><span>Time</span><Slider label="Duration" value={s.ms} min={200} max={10000} step={100} onChange={(v) => upd(s.id, { ms: v })} format={(v) => `${(v / 1000).toFixed(1)}s`} /></label>
                </>}
                {s.kind === 'mode' && <>
                  <span className="step-kind">Mode</span>
                  <select className="lg-field step-sel" value={s.m} onChange={(e) => upd(s.id, { m: e.target.value as DriveMode })}>
                    {MODES.map((md) => <option key={md.id} value={md.id}>{md.label} ({md.cap}%)</option>)}
                  </select>
                </>}
                {s.kind === 'raw' && <span className="step-kind">Recorded · thr {s.thr} · str {s.str} · {(s.ms / 1000).toFixed(1)} s</span>}
                <span className="step-tools">
                  <button className="lg-icon-btn sm" onClick={() => move(i, -1)} aria-label="Move up"><Icon name="up" size={15} /></button>
                  <button className="lg-icon-btn sm" onClick={() => move(i, 1)} aria-label="Move down"><Icon name="down" size={15} /></button>
                  <button className="lg-icon-btn sm" onClick={() => del(s.id)} aria-label="Delete step"><Icon name="trash" size={15} /></button>
                </span>
              </div>
            ))}
            {m.steps.length === 0 && <p className="lg-text-3 empty">No steps yet — add a move below.</p>}
          </div>
          <div className="add-row">
            <button className="lg-btn" onClick={() => add({ id: sid(), kind: 'move', move: 'forward', speed: 50, ms: 1500 })}><Icon name="plus" size={15} />Move</button>
            <button className="lg-btn" onClick={() => add({ id: sid(), kind: 'move', move: 'wait', speed: 0, ms: 800 })}><Icon name="plus" size={15} />Pause</button>
            <button className="lg-btn" onClick={() => add({ id: sid(), kind: 'mode', m: 'cruise' })}><Icon name="plus" size={15} />Mode change</button>
          </div>
        </div>
        <aside className="editor-side">
          <div className="lg-tile preview-tile">
            <span className="lg-label">Predicted path</span>
            <PathPreview pts={pts} />
            <p className="lg-text-2">{m.steps.length} steps · {(missionMs(m) / 1000).toFixed(1)} s · estimate at 50% cap</p>
          </div>
          <div className="editor-actions">
            <button className="lg-btn" onClick={close}>Cancel</button>
            <button className="lg-btn" onClick={() => onRun(m)}><Icon name="play" size={15} />Save & run</button>
            <button className="lg-btn is-primary" onClick={save}><Icon name="check" size={16} />Save</button>
          </div>
        </aside>
      </div>
    </Sheet>
  );
}
