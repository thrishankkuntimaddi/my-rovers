import { Sheet } from '../components/Common';
import { Icon } from '../components/Icon';
import { useStore } from '../state/store';
import { settings } from '../state/settings';
import { rover, type StepId } from '../rover/controller';

const STEPS: { id: StepId; title: string; sub: string; demoSub: string }[] = [
  { id: 'wifi', title: 'Wi-Fi', sub: 'Joined MARK1_ROVER', demoSub: 'Virtual hotspot' },
  { id: 'reach', title: 'Reach rover', sub: 'Looking for the rover', demoSub: 'Simulated rover online' },
  { id: 'handshake', title: 'Handshake', sub: 'Live control link', demoSub: 'Telemetry streaming' },
];

export function ConnectSheet({ open, demo, onClose, onRetry, onDemo }: { open: boolean; demo: boolean; onClose(): void; onRetry(): void; onDemo(): void }) {
  const r = useStore(rover);
  const { host } = useStore(settings);
  const failed = r.status === 'idle' && r.error;
  return (
    <Sheet open={open} onClose={onClose} title={demo ? 'Starting demo' : 'Connecting to MARK 1'}>
      <div className="steps">
        {STEPS.map((s) => {
          const st = r.steps[s.id];
          return (
            <div key={s.id} className={`step is-${st}`}>
              <span className="step-ic">
                {st === 'ok' ? <Icon name="check" size={16} /> : st === 'fail' ? <Icon name="x" size={16} /> : st === 'active' ? <span className="spinner" /> : null}
              </span>
              <div><b>{s.title}</b><span className="lg-text-2">{demo ? s.demoSub : s.id === 'reach' ? `${s.sub} at ${host}` : s.sub}</span></div>
            </div>
          );
        })}
      </div>
      {failed && (
        <div className="connect-error">
          <p>{r.error}</p>
          <ul className="lg-text-2">
            <li>Is the rover on? (blue LED blinking)</li>
            <li>Is this device on the <b>MARK1_ROVER</b> Wi-Fi?</li>
            <li>If Android asked "no internet — stay connected?", choose <b>Yes</b>.</li>
          </ul>
        </div>
      )}
      <div className="sheet-actions">
        {failed ? (
          <>
            <button className="lg-btn" onClick={onDemo}><Icon name="play" size={16} />Use demo</button>
            <button className="lg-btn is-primary" onClick={onRetry}><Icon name="refresh" size={17} />Try again</button>
          </>
        ) : (
          <button className="lg-btn" onClick={onClose}>Cancel</button>
        )}
      </div>
    </Sheet>
  );
}
