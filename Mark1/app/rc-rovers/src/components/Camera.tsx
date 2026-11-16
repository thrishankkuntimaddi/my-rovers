/* Camera view: the car's live video, nothing simulated.
   - Shows the MJPEG stream from Settings → Camera stream, or the ESP32-CAM default
     (http://<host>:81/stream) when the rover reports the "camera" capability.
   - No camera yet → a "Connect a camera" panel with the address field.
   A thin HUD (REC, time, speed, battery, latency, reticle) sits on top, with
   snapshot / clip / full-screen buttons. */
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { settings } from '../state/settings';
import { rover } from '../rover/controller';
import { odo } from '../state/odometry';
import { capture, registerFeed, snapshot, toggleClip } from '../lib/capture';
import { Icon } from './Icon';

export function cameraUrl(): string {
  const s = settings.get(), r = rover.get();
  if (s.cameraUrl.trim()) return s.cameraUrl.trim();
  if (r.status === 'connected' && r.kind !== 'demo' && r.info?.caps.includes('camera')) return `http://${s.host.trim() || '192.168.4.1'}:81/stream`;
  return '';
}
export const hasCamera = () => !!cameraUrl();

/* ── live stream ───────────────────────────────────────────────── */
function StreamFeed({ url }: { url: string }) {
  const [nonce, setNonce] = useState(0);
  const [cors, setCors] = useState(true);   // CORS first so snapshots/clips work; fall back if the camera refuses
  const [state, setState] = useState<'loading' | 'ok' | 'err'>('loading');
  const img = useRef<HTMLImageElement>(null);
  const src = url + (nonce ? (url.includes('?') ? '&' : '?') + `r=${nonce}` : '');
  useEffect(() => { setState('loading'); const t = setTimeout(() => setState((s) => (s === 'loading' ? 'err' : s)), 7000); return () => clearTimeout(t); }, [src, cors]);
  useEffect(() => { const el = img.current; if (state !== 'ok' || !el) return; registerFeed(el, 'CAM 1 · LIVE'); return () => registerFeed(null, '', el); }, [state]);
  useEffect(() => { if (state !== 'err') return; const t = setTimeout(() => setNonce((n) => n + 1), 4000); return () => clearTimeout(t); }, [state]);   // auto-retry
  return (
    <>
      <img key={src + cors} ref={img} className="cam-feed" src={src} alt="Rover camera" crossOrigin={cors ? 'anonymous' : undefined}
        onLoad={() => setState('ok')} onError={() => { if (cors) setCors(false); else setState('err'); }} />
      {state !== 'ok' && (
        <div className="cam-msg">
          {state === 'loading' ? <><span className="spinner" />Connecting to camera…</> : <>
            <Icon name="camera" size={20} /><b>No camera signal</b><small>{url}</small><small>Retrying…</small>
            <button className="lg-btn cam-retry" onClick={() => setNonce((n) => n + 1)}><Icon name="refresh" size={15} />Retry now</button>
          </>}
        </div>
      )}
    </>
  );
}

/* ── HUD overlay ───────────────────────────────────────────────── */
function Overlay() {
  const o = useStore(odo);
  const r = useStore(rover);
  const cap = useStore(capture);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(id); }, []);
  const clipS = cap.clip ? Math.floor((now - cap.since) / 1000) : 0;
  const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  return (
    <div className="cam-hud">
      <span className="cam-corner is-tl" /><span className="cam-corner is-tr" /><span className="cam-corner is-bl" /><span className="cam-corner is-br" />
      <div className="cam-tl"><i className={`cam-live${r.status === 'connected' ? ' is-on' : ''}`} />CAM 1 · LIVE</div>
      <div className="cam-tr">
        {cap.clip ? <span className="cam-rec"><i />REC {mmss(clipS)}</span> : <span>{new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
      </div>
      <div className="cam-reticle"><span /></div>
      <div className="cam-bl"><b>{(o.speed * 3.6).toFixed(1)}</b><small>km/h</small></div>
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
  useStore(rover);
  const cap = useStore(capture);
  const url = cameraUrl();
  if (!url) {
    return (
      <div className="cam is-empty">
        <Icon name="camera" size={26} />
        <b>Connect a camera</b>
        <small>Mount an ESP32-CAM on MARK 1, join it to the rover's Wi-Fi and paste its stream address here.</small>
        <input className="lg-field cam-url" placeholder="http://192.168.4.2:81/stream" spellCheck={false} inputMode="url"
          onKeyDown={(e) => { if (e.key === 'Enter') settings.set({ cameraUrl: (e.target as HTMLInputElement).value }); }}
          onBlur={(e) => { if (e.target.value) settings.set({ cameraUrl: e.target.value }); }} />
      </div>
    );
  }
  return (
    <div className={`cam${full ? ' is-full' : ''}`}>
      <StreamFeed url={url} />
      <Overlay />
      <div className="cam-actions">
        <button className="lg-icon-btn sm cam-act" onClick={snapshot} aria-label="Take photo"><Icon name="aperture" size={15} /></button>
        <button className={`lg-icon-btn sm cam-act${cap.clip ? ' is-rec' : ''}`} onClick={toggleClip} aria-label={cap.clip ? 'Stop video' : 'Record video'}><Icon name={cap.clip ? 'stop' : 'video'} size={15} /></button>
        {onToggleFull && (
          <button className="lg-icon-btn sm cam-act" onClick={onToggleFull} aria-label={full ? 'Exit full screen' : 'Full screen'}>
            <Icon name={full ? 'shrink' : 'expand'} size={15} />
          </button>
        )}
      </div>
    </div>
  );
}
