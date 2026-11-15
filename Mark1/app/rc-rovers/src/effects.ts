/* App-wide side effects, wired once at start-up. */
import './state/odometry';
import './state/academy';
import './ai/voice';
import './sim/trials';
import { haptic } from './lib/native';
import { bus } from './state/bus';
import { rover } from './rover/controller';
import { chime, motor, sfx } from './lib/sound';
import { initGamepad } from './input/sources';
import { autoCheck } from './lib/updater';
import { logEvent } from './state/logs';
import { APP_VERSION } from './rover/protocol';

bus.on('rover', ({ e }) => {
  if (e === 'armed') { chime('arm'); sfx('spool'); }
  else if (e === 'disarmed') { chime('disarm'); sfx('click'); }
  else if (e === 'estop' || e === 'cutoff') { chime('stop'); sfx('brake'); }
  else if (e === 'failsafe' || e === 'lowbat') chime('error');
});
bus.on('lost', () => chime('error'));
bus.on('bump', () => { sfx('bump'); haptic('heavy'); });

let lastArmed = false, lastThr = 0, lastStr = 0;
rover.subscribe(() => {
  const { tel, status } = rover.get();
  const armed = status === 'connected' && tel.armed;
  if (armed !== lastArmed || Math.abs(tel.thr - lastThr) >= 1 || Math.abs(tel.str - lastStr) >= 1) {
    lastArmed = armed; lastThr = tel.thr; lastStr = tel.str;
    motor(armed, tel.thr, tel.str);
  }
});

initGamepad();
autoCheck();
logEvent('system', `RC-Rovers ${APP_VERSION} started`);
