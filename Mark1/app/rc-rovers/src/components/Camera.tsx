/* Camera view.
   - Real rover: shows the MJPEG stream from Settings → Camera stream, or the ESP32-CAM
     default (http://<host>:81/stream) when the rover reports the "camera" capability.
   - Demo rover: a simulated FPV feed rendered from the odometry pose (ground grid,
     rocks, beacons and time-trial gates) so the view moves exactly like the rover does.
   A thin HUD (heading tape, reticle, minimap, speed, battery, REC) sits on top, with
   snapshot / clip buttons. Bumping a rock shakes the picture. */
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { settings } from '../state/settings';
import { rover } from '../rover/controller';
import { odo } from '../state/odometry';
import { recorder } from '../missions/missions';
import { bus } from '../state/bus';
import { capture, registerFeed, snapshot, toggleClip } from '../lib/capture';
import { courseById, gatePosts, SOLIDS, WORLD, type Gate } from '../sim/world';
import { trial } from '../sim/trials';
import { Icon } from './Icon';

function cameraSource(): { kind: 'sim' | 'stream' | 'none'; url: string } {
  const s = settings.get(), r = rover.get();
  if (s.cameraUrl.trim()) return { kind: 'stream', url: s.cameraUrl.trim() };
  if (r.kind === 'demo') return { kind: 'sim', url: '' };
  if (r.info?.caps.includes('camera')) return { kind: 'stream', url: `http://${s.host.trim() || '192.168.4.1'}:81/stream` };
  return { kind: 'none', url: '' };
}

/** Gates of the active trial with their state: 'next' | 'todo' | 'done'. */
function trialGates(): { gt: Gate; st: 'next' | 'todo' | 'done'; n: number }[] {
  const t = trial.get();
  const c = t.phase === 'idle' ? null : courseById(t.course);
  if (!c) return [];
  return c.gates.map((gt, i) => ({ gt, n: i + 1, st: i < t.next ? 'done' : i === t.next && t.phase !== 'done' ? 'next' : 'todo' }));
}

/* ── simulated FPV ─────────────────────────────────────────────── */
function SimFeed() {
  const cv = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = cv.current!;
    registerFeed(c, 'CAM 1 · SIM');
    const g = c.getContext('2d')!;
    let raf = 0, W = 0, H = 0, dpr = 1;
    const ro = new ResizeObserver(() => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = c.clientWidth; H = c.clientHeight;
      c.width = Math.max(1, W * dpr); c.height = Math.max(1, H * dpr);
    });
    ro.observe(c);
    let shakeAt = -1e9;
    const offBump = bus.on('bump', () => { shakeAt = performance.now(); });
    const dark = () => document.documentElement.getAttribute('data-theme') === 'dark';
    let bob = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!W || !H) return;
      const o = odo.get(), tel = rover.get().tel;
      const sp = Math.abs(tel.thr) / 100;
      bob += sp * 0.35;
      const f = W * 0.85, camH = 0.16;
      const roll = (-tel.str / 100) * 2.2 * Math.min(1, sp * 2) * (Math.PI / 180);
      const shake = Math.max(0, 1 - (now - shakeAt) / 450);
      const sx0 = shake ? (Math.random() - 0.5) * 16 * shake : 0, sy0 = shake ? (Math.random() - 0.5) * 12 * shake : 0;
      const hz = H * 0.44 + Math.sin(bob) * sp * 2.2 + Math.sin(now / 900) * 0.6;
      const sh = Math.sin(o.h), ch = Math.cos(o.h);
      const proj = (wx: number, wy: number, up = 0) => {
        const dx = wx - o.x, dy = wy - o.y;
        const fw = dx * sh + dy * ch, rt = dx * ch - dy * sh;
        return { fw, sx: W / 2 + (rt / fw) * f, sy: hz + ((camH - up) / fw) * f };
      };
      const dk = dark();
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.save();
      g.translate(W / 2 + sx0, H / 2 + sy0); g.rotate(roll + shake * (Math.random() - 0.5) * 0.03); g.scale(1.06, 1.06); g.translate(-W / 2, -H / 2);
      // sky + ground
      const sky = g.createLinearGradient(0, 0, 0, hz);
      sky.addColorStop(0, dk ? '#05080F' : '#8FB7D9'); sky.addColorStop(1, dk ? '#1A2B3D' : '#E9EEF2');
      g.fillStyle = sky; g.fillRect(-W, -H, W * 3, hz + H);
      const gr = g.createLinearGradient(0, hz, 0, H);
      gr.addColorStop(0, dk ? '#1C2026' : '#B9AE9C'); gr.addColorStop(1, dk ? '#0B0D10' : '#7C6F5E');
      g.fillStyle = gr; g.fillRect(-W, hz, W * 3, H * 2);
      // distant ridge
      g.fillStyle = dk ? 'rgba(80,110,140,.22)' : 'rgba(90,110,130,.25)';
      g.beginPath(); g.moveTo(-W, hz);
      for (let i = 0; i <= 48; i++) {
        const a = o.h + (i / 48 - 0.5) * 1.6;
        const hgt = 10 + 8 * Math.sin(a * 3.1) + 5 * Math.sin(a * 7.3 + 1) + 3 * Math.sin(a * 13.7);
        g.lineTo(-W * 0.25 + (i / 48) * W * 1.5, hz - hgt * (H / 400));
      }
      g.lineTo(W * 2, hz); g.closePath(); g.fill();
      // ground grid (1 m)
      g.lineWidth = 1;
      g.strokeStyle = dk ? 'rgba(94,231,255,.16)' : 'rgba(255,255,255,.32)';
      const R = 18, cx = Math.round(o.x), cy = Math.round(o.y);
      for (let pass = 0; pass < 2; pass++) {
        for (let i = -R; i <= R; i++) {
          g.beginPath(); let pen = false;
          for (let j = -R; j <= R; j += 0.5) {
            const p = pass ? proj(cx + i, cy + j) : proj(cx + j, cy + i);
            if (p.fw < 0.25) { pen = false; continue; }
            if (pen) g.lineTo(p.sx, p.sy); else { g.moveTo(p.sx, p.sy); pen = true; }
          }
          g.stroke();
        }
      }
      // scene items, far → near
      type Item = { fw: number; draw(): void };
      const items: Item[] = [];
      for (const ob of WORLD) {
        const p = proj(ob.x, ob.y);
        if (p.fw < 0.2 || p.fw > 34) continue;
        const sz = (ob.s / p.fw) * f;
        if (p.sx < -sz * 2 || p.sx > W + sz * 2) continue;
        const fog = Math.max(0, Math.min(1, 1 - p.fw / 34));
        items.push({ fw: p.fw, draw() {
          g.globalAlpha = fog;
          if (ob.k === 'rock') {
            g.fillStyle = dk ? '#3A414B' : '#8A7E6E';
            g.beginPath(); g.ellipse(p.sx, p.sy - sz * 0.35, sz * 1.1, sz * 0.6, 0, 0, Math.PI * 2); g.fill();
            g.fillStyle = dk ? 'rgba(255,255,255,.08)' : 'rgba(255,255,255,.25)';
            g.beginPath(); g.ellipse(p.sx - sz * 0.3, p.sy - sz * 0.6, sz * 0.5, sz * 0.22, 0, 0, Math.PI * 2); g.fill();
          } else if (ob.k === 'grass') {
            g.strokeStyle = dk ? 'rgba(120,170,140,.5)' : 'rgba(80,110,60,.6)'; g.lineWidth = Math.max(1, sz * 0.08);
            g.beginPath();
            for (let b = -2; b <= 2; b++) { g.moveTo(p.sx + b * sz * 0.18, p.sy); g.lineTo(p.sx + b * sz * 0.35, p.sy - sz * (0.9 + (b & 1) * 0.3)); }
            g.stroke();
          } else {
            const ph = sz * 7;
            g.fillStyle = dk ? '#5EE7FF' : '#FF7A1A';
            g.fillRect(p.sx - sz * 0.12, p.sy - ph, sz * 0.24, ph);
            g.globalAlpha = fog * (0.55 + 0.45 * Math.sin(now / 220 + ob.x));
            g.beginPath(); g.arc(p.sx, p.sy - ph, sz * 0.45, 0, Math.PI * 2); g.fill();
          }
        } });
      }
      // trial gates: two glowing posts and a bar; the next one pulses
      for (const { gt, st, n } of trialGates()) {
        if (st === 'done') continue;
        const [[ax, ay], [bx, by]] = gatePosts(gt);
        const pa = proj(ax, ay), pb = proj(bx, by), ta = proj(ax, ay, 0.42), tb = proj(bx, by, 0.42);
        if (pa.fw < 0.35 || pb.fw < 0.35) continue;   // too close to draw sensibly
        const fw = (pa.fw + pb.fw) / 2;
        if (fw > 40) continue;
        items.push({ fw, draw() {
          const next = st === 'next';
          const col = next ? (dk ? '94,231,255' : '0,170,220') : '255,255,255';
          const pulse = next ? 0.75 + 0.25 * Math.sin(now / 160) : 0.45;
          g.globalAlpha = Math.max(0.15, Math.min(1, 1.2 - fw / 34)) * pulse;
          if (next) {   // translucent curtain
            g.fillStyle = `rgba(${col},.12)`;
            g.beginPath(); g.moveTo(pa.sx, pa.sy); g.lineTo(ta.sx, ta.sy); g.lineTo(tb.sx, tb.sy); g.lineTo(pb.sx, pb.sy); g.closePath(); g.fill();
          }
          g.strokeStyle = `rgb(${col})`; g.lineCap = 'round';
          for (const [p, t] of [[pa, ta], [pb, tb]] as const) { g.lineWidth = Math.min(10, Math.max(2, (0.03 / p.fw) * f)); g.beginPath(); g.moveTo(p.sx, p.sy); g.lineTo(t.sx, t.sy); g.stroke(); }
          g.lineWidth = Math.min(6, Math.max(1.5, (0.02 / fw) * f));
          g.beginPath(); g.moveTo(ta.sx, ta.sy); g.lineTo(tb.sx, tb.sy); g.stroke();
          g.fillStyle = `rgb(${col})`; g.font = `700 ${Math.max(10, Math.min(28, (0.14 / fw) * f))}px -apple-system, Inter, sans-serif`; g.textAlign = 'center';
          g.fillText(String(n), (ta.sx + tb.sx) / 2, (ta.sy + tb.sy) / 2 - 6);
          g.lineCap = 'butt';
        } });
      }
      items.sort((a, b) => b.fw - a.fw).forEach((it) => it.draw());
      g.globalAlpha = 1;
      g.restore();
      // vignette + scanlines
      const vg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, `rgba(${shake > 0.3 ? '120,0,0' : '0,0,0'},.42)`);
      g.fillStyle = vg; g.fillRect(0, 0, W, H);
      g.fillStyle = 'rgba(0,0,0,.05)';
      for (let y = (now / 40) % 3; y < H; y += 3) g.fillRect(0, y, W, 1);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); offBump(); registerFeed(null, ''); };
  }, []);
  return <canvas ref={cv} className="cam-feed" />;
}

/* ── live stream ───────────────────────────────────────────────── */
function StreamFeed({ url }: { url: string }) {
  const [nonce, setNonce] = useState(0);
  const src = url + (nonce ? (url.includes('?') ? '&' : '?') + `r=${nonce}` : '');
  return <StreamImg key={src} src={src} url={url} retry={() => setNonce((n) => n + 1)} />;
}
function StreamImg({ src, url, retry }: { src: string; url: string; retry(): void }) {
  const [state, setState] = useState<'loading' | 'ok' | 'err'>('loading');
  const img = useRef<HTMLImageElement>(null);
  useEffect(() => { registerFeed(img.current, 'CAM 1 · LIVE'); return () => registerFeed(null, ''); }, []);
  return (
    <>
      <img ref={img} className="cam-feed" src={src} alt="Rover camera" onLoad={() => setState('ok')} onError={() => setState('err')} />
      {state !== 'ok' && (
        <div className="cam-msg">
          {state === 'loading' ? <><span className="spinner" />Connecting to camera…</> : <>
            <Icon name="camera" size={20} /><b>No camera signal</b><small>{url}</small>
            <button className="lg-btn cam-retry" onClick={retry}><Icon name="refresh" size={15} />Retry</button>
          </>}
        </div>
      )}
    </>
  );
}

/* ── minimap: rover-centred, heading-up ────────────────────────── */
function MiniMap({ sim }: { sim: boolean }) {
  const o = useStore(odo);
  useStore(trial);
  const R = 46, span = 7;                       // px radius, metres to the edge
  const k = R / span;
  const sh = Math.sin(o.h), ch = Math.cos(o.h);
  const loc = (x: number, y: number) => { const dx = x - o.x, dy = y - o.y; return [R + (dx * ch - dy * sh) * k, R - (dx * sh + dy * ch) * k] as const; };
  const near = (x: number, y: number) => Math.abs(x - o.x) < span * 1.5 && Math.abs(y - o.y) < span * 1.5;
  const trail = o.trail.slice(-300).map(([x, y], i) => { const [a, b] = loc(x, y); return `${i ? 'L' : 'M'}${a.toFixed(1)} ${b.toFixed(1)}`; }).join(' ');
  return (
    <svg className="cam-mini" viewBox={`0 0 ${R * 2} ${R * 2}`}>
      <defs><clipPath id="mini-clip"><circle cx={R} cy={R} r={R - 1} /></clipPath></defs>
      <circle cx={R} cy={R} r={R - 1} className="mini-bg" />
      <g clipPath="url(#mini-clip)">
        <circle cx={R} cy={R} r={R / 2} className="mini-ring" />
        <path d={trail} className="mini-trail" />
        {sim && SOLIDS.filter((s) => near(s.x, s.y)).map((s, i) => { const [a, b] = loc(s.x, s.y); return <circle key={i} cx={a} cy={b} r={Math.max(1.4, s.r * k)} className={s.k === 'beacon' ? 'mini-beacon' : 'mini-rock'} />; })}
        {trialGates().filter((t) => t.st !== 'done').map(({ gt, st, n }) => {
          const [[ax, ay], [bx, by]] = gatePosts(gt); const [a1, b1] = loc(ax, ay), [a2, b2] = loc(bx, by);
          return <line key={n} x1={a1} y1={b1} x2={a2} y2={b2} className={`mini-gate${st === 'next' ? ' is-next' : ''}`} />;
        })}
      </g>
      <path d={`M${R} ${R - 6} L${R + 4.5} ${R + 4} L${R} ${R + 2} L${R - 4.5} ${R + 4} Z`} className="mini-me" />
    </svg>
  );
}

/* ── HUD overlay ───────────────────────────────────────────────── */
function Overlay({ live, label, sim }: { live: boolean; label: string; sim: boolean }) {
  const o = useStore(odo);
  const r = useStore(rover);
  const rec = useStore(recorder);
  const cap = useStore(capture);
  const t = useStore(trial);
  const deg = (((o.h * 180) / Math.PI) % 360 + 360) % 360;
  const ticks = [];
  for (let d = Math.floor((deg - 60) / 10) * 10; d <= deg + 60; d += 10) {
    const n = ((d % 360) + 360) % 360;
    const lab = n === 0 ? 'N' : n === 90 ? 'E' : n === 180 ? 'S' : n === 270 ? 'W' : n % 30 === 0 ? String(n) : '';
    ticks.push(<span key={d} className={`cam-tick${lab ? ' is-major' : ''}`} style={{ left: `${50 + ((d - deg) / 120) * 100}%` }}>{lab && <em>{lab}</em>}</span>);
  }
  // bearing to the next trial gate, shown on the tape
  const nextGate = trialGates().find((x) => x.st === 'next');
  let gateMark = null;
  if (nextGate) {
    const b = (Math.atan2(nextGate.gt.x - o.x, nextGate.gt.y - o.y) * 180) / Math.PI;
    const rel = ((b - deg + 540) % 360) - 180;
    const pos = Math.max(-58, Math.min(58, rel));
    gateMark = <span className={`cam-gate-mark${Math.abs(rel) > 58 ? ' is-edge' : ''}`} style={{ left: `${50 + (pos / 120) * 100}%` }}>{Math.abs(rel) > 58 ? (rel > 0 ? '▶' : '◀') : '▼'}</span>;
  }
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(id); }, []);
  const clipS = cap.clip ? Math.floor((now - cap.since) / 1000) : 0;
  const recS = rec.on ? Math.floor((now - rec.since) / 1000) : 0;
  const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  return (
    <div className="cam-hud">
      <span className="cam-corner is-tl" /><span className="cam-corner is-tr" /><span className="cam-corner is-bl" /><span className="cam-corner is-br" />
      <div className="cam-tape"><div className="cam-tape-in">{ticks}{gateMark}</div><b className="cam-hdg">{Math.round(deg).toString().padStart(3, '0')}°</b></div>
      <div className="cam-tl"><i className={`cam-live${live ? ' is-on' : ''}`} />{label}</div>
      <div className="cam-tr">
        {cap.clip ? <span className="cam-rec"><i />CLIP {mmss(clipS)}</span> : rec.on ? <span className="cam-rec"><i />REC {mmss(recS)}</span> : <span>{new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
      </div>
      <MiniMap sim={sim} />
      <div className="cam-reticle"><span /></div>
      {t.phase === 'countdown' && <div className="cam-count" key={t.count}>{t.count}</div>}
      <div className="cam-bl"><b>{o.speed.toFixed(1)}</b><small>m/s</small></div>
      <div className="cam-br">
        <span>{r.tel.pct != null ? `${r.tel.pct}%` : '—'}</span>
        <span>{r.latency != null ? `${r.latency} ms` : ''}</span>
      </div>
      {cap.flash > 0 && <div className="cam-flash" key={cap.flash} />}
    </div>
  );
}

export function CameraView({ full, onToggleFull }: { full?: boolean; onToggleFull?(): void }) {
  useStore(settings);
  const r = useStore(rover);
  const cap = useStore(capture);
  const src = cameraSource();
  if (src.kind === 'none') {
    return (
      <div className="cam is-empty">
        <Icon name="camera" size={26} />
        <b>No camera attached</b>
        <small>MARK 1 has no camera yet. Add an ESP32-CAM and paste its stream address, or try the demo rover.</small>
        <input className="lg-field cam-url" placeholder="http://192.168.4.2:81/stream" spellCheck={false} inputMode="url"
          onKeyDown={(e) => { if (e.key === 'Enter') settings.set({ cameraUrl: (e.target as HTMLInputElement).value }); }}
          onBlur={(e) => { if (e.target.value) settings.set({ cameraUrl: e.target.value }); }} />
      </div>
    );
  }
  return (
    <div className={`cam${full ? ' is-full' : ''}`}>
      {src.kind === 'sim' ? <SimFeed /> : <StreamFeed url={src.url} />}
      <Overlay live={r.status === 'connected'} label={src.kind === 'sim' ? 'CAM 1 · SIM' : 'CAM 1 · LIVE'} sim={src.kind === 'sim'} />
      <div className="cam-actions">
        <button className="lg-icon-btn sm cam-act" onClick={snapshot} aria-label="Take snapshot"><Icon name="aperture" size={15} /></button>
        <button className={`lg-icon-btn sm cam-act${cap.clip ? ' is-rec' : ''}`} onClick={toggleClip} aria-label={cap.clip ? 'Stop clip' : 'Record clip'}><Icon name={cap.clip ? 'stop' : 'video'} size={15} /></button>
        {onToggleFull && (
          <button className="lg-icon-btn sm cam-act" onClick={onToggleFull} aria-label={full ? 'Exit camera cockpit' : 'Camera cockpit'}>
            <Icon name={full ? 'shrink' : 'expand'} size={15} />
          </button>
        )}
      </div>
    </div>
  );
}
