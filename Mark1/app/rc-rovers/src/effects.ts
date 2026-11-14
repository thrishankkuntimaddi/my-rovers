/* App-wide side effects, wired once at start-up. */
import './state/odometry';
import './state/academy';
import './ai/voice';
import { bus } from './state/bus';
import { rover } from './rover/controller';
import { chime, engine } from './lib/sound';
import { initGamepad } from './input/sources';
import { logEvent } from './state/logs';
import { APP_VERSION } from './rover/protocol';

bus.on('rover', ({ e }) => {
  if (e === 'armed') chime('arm');
  else if (e === 'disarmed') chime('disarm');
  else if (e === 'estop' || e === 'cutoff') chime('stop');
  else if (e === 'failsafe' || e === 'lowbat') chime('error');
});
bus.on('lost', () => chime('error'));

let lastArmed = false, lastThr = 0;
rover.subscribe(() => {
  const { tel, status } = rover.get();
  const armed = status === 'connected' && tel.armed;
  if (armed !== lastArmed || Math.abs(tel.thr - lastThr) >= 1) { lastArmed = armed; lastThr = tel.thr; engine(armed, tel.thr); }
});

initGamepad();
logEvent('system', `RC-Rovers ${APP_VERSION} started`);
