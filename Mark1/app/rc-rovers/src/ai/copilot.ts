/* NOVA — the offline co-pilot.
   A deterministic natural-language engine: it splits what you say into clauses
   ("…then…"), understands motion (direction, speed, duration or distance), modes,
   ignition, status questions, missions, recording, settings and navigation, and
   turns them into actions. No internet, no API key — works on the rover's Wi-Fi. */
import { createStore } from '../state/store';
import { settings, type Settings } from '../state/settings';
import { bus } from '../state/bus';
import { logEvent } from '../state/logs';
import { toast } from '../state/ui';
import { control, rover } from '../rover/controller';
import { MODES, modeSpec, type DriveMode } from '../rover/protocol';
import { cruise } from '../rover/controller';
import { snapshot, startClip, stopClip, capture } from '../lib/capture';
import { hasCamera } from '../components/Camera';
import { odo, VMAX } from '../state/odometry';
import { allMissions, findMission, quickMission, runMission, startRecording, stopMission, stopRecording, recorder, sid, type Move, type Step } from '../missions/missions';
import { input } from '../state/ui';
import { LiquidGlass } from '../lib/liquid-glass';
import { haptic } from '../lib/native';

export type NavTarget = 'garage' | 'build' | 'drive' | 'missions' | 'nova' | 'logs' | 'academy' | 'settings';

export interface ChatMsg { id: number; from: 'you' | 'nova'; text: string; at: number; tone?: 'neutral' | 'good' | 'warn' | 'bad'; source?: 'typed' | 'voice' | 'tip' }
export const nova = createStore<{ messages: ChatMsg[]; lastReply: string; navRequest: NavTarget | null }>({
  messages: [{ id: 0, from: 'nova', at: Date.now(), text: "Hi, I'm Nova, your co-pilot. Tell me where to go — like “start engine”, “forward slowly for 3 seconds then turn left”, or “run the square mission”. Say “help” any time." }],
  lastReply: '', navRequest: null,
});

let mid = 1;
function push(from: ChatMsg['from'], text: string, extra: Partial<ChatMsg> = {}) {
  nova.set((s) => ({ messages: [...s.messages, { id: mid++, from, text, at: Date.now(), ...extra }].slice(-200), ...(from === 'nova' ? { lastReply: text } : {}) }));
}

/* ── language helpers ──────────────────────────────────────────── */
const NUMS: Record<string, number> = {
  zero: 0, one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, half: 0.5,
};
function normalize(t: string) {
  let s = ` ${t.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9.%+\- ]/g, ' ')} `;
  s = s.replace(/\bfigure (8|eight)\b/g, 'figure8').replace(/\bzig ?zag\b/g, 'zigzag').replace(/\bu ?turn\b/g, 'uturn')
    .replace(/\bthree point turn\b|\b3 point turn\b/g, 'threepointturn').replace(/\bhalf a (second|meter|metre)/g, '0.5 $1')
    .replace(/\ba (second|meter|metre|minute)\b/g, '1 $1');
  s = s.replace(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[ -](one|two|three|four|five|six|seven|eight|nine)\b/g, (_, a, b) => String(NUMS[a] + NUMS[b]));
  s = s.replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)\b/g, (w) => String(NUMS[w]));
  return s.replace(/\s+/g, ' ').trim();
}
const has = (s: string, re: RegExp) => re.test(s);
const splitClauses = (s: string) => s.split(/\b(?:and then|then|after that|afterwards|next|followed by)\b|[;,]/).map((c) => c.trim()).filter(Boolean);

/* ── intents ───────────────────────────────────────────────────── */
type Action =
  | { t: 'stop' } | { t: 'estop' } | { t: 'arm' } | { t: 'disarm' } | { t: 'mode'; m: DriveMode }
  | { t: 'steps'; steps: Step[]; label: string }
  | { t: 'mission'; name: string } | { t: 'record' } | { t: 'saveRecord' } | { t: 'replay' }
  | { t: 'set'; patch: Partial<Settings>; say: string } | { t: 'theme'; v: 'light' | 'dark' | 'system' }
  | { t: 'nav'; to: NavTarget } | { t: 'reply'; text: string }
  | { t: 'hold'; on: boolean } | { t: 'shift'; dir: 1 | -1 } | { t: 'photo' } | { t: 'video'; on: boolean };


function speedOf(c: string): number | null {
  const pct = c.match(/(\d+(?:\.\d+)?)\s*(?:%|percent|per cent)/); if (pct) return Math.min(100, +pct[1]);
  if (has(c, /\b(full speed|max(imum)?( speed)?|flat out|as fast as)/)) return 100;
  if (has(c, /\b(very slow(ly)?|super slow|crawl(ing)? speed|inch)/)) return 20;
  if (has(c, /\b(slow(ly)?|gentl[ey]|careful(ly)?|easy)\b/)) return 32;
  if (has(c, /\b(fast|quick(ly)?|speed up|hurry|rapid(ly)?)\b/)) return 85;
  if (has(c, /\b(medium|normal|moderate)\b/)) return 55;
  return null;
}
function durationOf(c: string, speed: number): number | null {
  const sec = c.match(/(\d+(?:\.\d+)?)\s*(s|sec|secs|second|seconds)\b/); if (sec) return Math.min(30000, +sec[1] * 1000);
  const ms = c.match(/(\d+)\s*(ms|milliseconds?)\b/); if (ms) return Math.min(30000, +ms[1]);
  const min = c.match(/(\d+(?:\.\d+)?)\s*(min|mins|minute|minutes)\b/); if (min) return Math.min(30000, +min[1] * 60000);
  const m = c.match(/(\d+(?:\.\d+)?)\s*(m|meter|meters|metre|metres)\b/);
  const cm = c.match(/(\d+(?:\.\d+)?)\s*(cm|centimeters?|centimetres?)\b/);
  const meters = m ? +m[1] : cm ? +cm[1] / 100 : null;
  if (meters != null) {
    const cap = modeSpec(rover.get().tel.mode).cap / 100;
    const v = Math.max(0.05, (speed / 100) * cap * VMAX);
    return Math.min(30000, (meters / v) * 1000);
  }
  if (has(c, /\b(a (little|bit|touch)|little bit|nudge|tiny)\b/)) return 600;
  if (has(c, /\b(keep going|continuous(ly)?|for a while|long way)\b/)) return 8000;
  return null;
}

function motionOf(c: string): Step | null {
  const back = has(c, /\b(back|backward|backwards|reverse|retreat)\b/);
  const fwd = has(c, /\b(forward|forwards|ahead|straight|go|drive|move|advance|onward)\b/);
  const left = has(c, /\bleft\b/), right = has(c, /\bright\b/);
  const spin = has(c, /\b(spin|tight|sharp|donut|doughnut)\b/);
  const turn = has(c, /\b(turn|steer|veer|bear|curve|go)\b/) || left || right;
  if (!back && !fwd && !left && !right) return null;
  const speed = speedOf(c) ?? (spin ? 60 : 50);
  let move: Move;
  if (left || right) move = spin ? (left ? 'spinleft' : 'spinright') : back ? (left ? 'backleft' : 'backright') : (left ? 'left' : 'right');
  else move = back ? 'back' : 'forward';
  if (!turn && !fwd && !back) return null;
  const ms = durationOf(c, speed) ?? (left || right ? 1000 : 1500);
  return { id: sid(), kind: 'move', move, speed, ms };
}

const MODE_WORDS: [RegExp, DriveMode][] = [
  [/\b(crawl|eco|economy|slowest)( mode)?\b/, 'crawl'], [/\b(cruise|normal|default|trail)( mode)\b|\bnormal\b|\bcruise\b/, 'cruise'],
  [/\b(sport|sporty|fast mode)\b/, 'sport'], [/\b(full|turbo|ludicrous|max)( mode| power)\b|\bturbo\b|\bfull power\b/, 'full'],
];

function parse(text: string): Action[] {
  const s = normalize(text);
  if (!s) return [];
  if (has(s, /\b(emergency|e stop|estop|abort|panic)\b/)) return [{ t: 'estop' }];
  if (has(s, /^(stop|halt|freeze|brake|whoa|wait|hold on|cancel)( it| now| the car| the rover| everything)?( please)?$/)) return [{ t: 'stop' }];

  const out: Action[] = [];
  const motion: Step[] = [];
  const flush = () => { if (motion.length) { out.push({ t: 'steps', steps: motion.splice(0), label: 'Nova route' }); } };

  for (const c of splitClauses(s)) {
    // ignition
    if (has(c, /\b(start|turn on|fire up|ignite|arm|power up|wake up)( the)? ?(engine|ignition|motors?|car|rover)?\b/) && !has(c, /\b(record|mission|recording)\b/) && (has(c, /\b(engine|ignition|motors?|arm)\b/) || /^(start|arm)$/.test(c))) { flush(); out.push({ t: 'arm' }); continue; }
    if (has(c, /\b(disarm|park|shut ?down|turn off|kill)( the)? ?(engine|ignition|motors?)?\b/) && !has(c, /\b(sound|haptic|voice|tilt|tips)\b/)) { flush(); out.push({ t: 'disarm' }); continue; }
    if (has(c, /^(stop|halt|brake|freeze)\b/) && !has(c, /record/)) { flush(); out.push({ t: 'stop' }); continue; }
    // speed hold (cruise control) — not the Normal drive mode
    if (has(c, /\b(cruise control|speed hold|hold (the |this |my )?speed|keep (this |the )?speed|lock (the )?(speed|throttle))\b/)) {
      flush(); out.push({ t: 'hold', on: !has(c, /\b(off|cancel|stop|release|disable|end)\b/) }); continue;
    }
    // camera
    if (has(c, /\b(take|snap|grab|capture)( a| the)? (photo|picture|pic|snapshot|screenshot)\b|^(photo|snapshot|screenshot|say cheese)$/)) { flush(); out.push({ t: 'photo' }); continue; }
    if (has(c, /\b(stop|end|finish|save) (the )?(video|clip|filming)\b/)) { flush(); out.push({ t: 'video', on: false }); continue; }
    if (has(c, /\b(record|start|take|film)( a| the)? (video|clip)\b|\bstart filming\b/)) { flush(); out.push({ t: 'video', on: true }); continue; }
    // gear up / down
    if (has(c, /^(go |drive |a bit |little )?(faster|more power|speed up|gear up|shift up)( please)?$/)) { flush(); out.push({ t: 'shift', dir: 1 }); continue; }
    if (has(c, /^(go |drive |a bit |little )?(slower|less power|slow down|gear down|shift down|calm down)( please)?$/)) { flush(); out.push({ t: 'shift', dir: -1 }); continue; }
    // recording
    if (has(c, /\b(stop|end|finish|save) (the )?record(ing)?\b/)) { flush(); out.push({ t: 'saveRecord' }); continue; }
    if (has(c, /\b(start )?record(ing)?( (a|my|this) (drive|route))?\b/) && !has(c, /\b(replay|play|video|clip)\b/)) { flush(); out.push({ t: 'record' }); continue; }
    if (has(c, /\b(replay|play back|playback)\b/)) { flush(); out.push({ t: 'replay' }); continue; }
    // missions by name
    const shape = c.match(/\b(square|circle|figure8|zigzag|patrol|dance|threepointturn|uturn|crawl test|turn around)\b/);
    const runNamed = c.match(/\b(?:run|start|do|play|execute|launch)(?: the| a| an| my)? (?:mission )?(.+?)(?: mission)?$/);
    if (shape && !has(c, /\bmode\b/)) {
      const map: Record<string, string> = { figure8: 'Figure 8', zigzag: 'Zig-zag', threepointturn: 'Three-point turn', uturn: 'Three-point turn', 'turn around': 'Three-point turn', 'crawl test': 'Crawl test' };
      flush(); out.push({ t: 'mission', name: map[shape[1]] ?? shape[1] }); continue;
    }
    if (runNamed && findMission(runNamed[1])) { flush(); out.push({ t: 'mission', name: findMission(runNamed[1])!.name }); continue; }
    // modes
    const mode = MODE_WORDS.find(([re]) => re.test(c));
    if (mode && (has(c, /\bmode|switch|change|set|use|go|power\b/) || c.split(' ').length <= 2)) { flush(); out.push({ t: 'mode', m: mode[1] }); continue; }
    // status questions
    if (has(c, /\b(battery|charge|juice|power left|volt)/)) { flush(); out.push({ t: 'reply', text: '§battery' }); continue; }
    if (has(c, /\b(signal|wifi|wi fi|connection|link|latency|lag|ping)\b/)) { flush(); out.push({ t: 'reply', text: '§signal' }); continue; }
    if (has(c, /\b(how long|runtime|time left|range)\b/)) { flush(); out.push({ t: 'reply', text: '§runtime' }); continue; }
    if (has(c, /\b(how far|distance|odometer|travel+ed)\b/)) { flush(); out.push({ t: 'reply', text: '§distance' }); continue; }
    if (has(c, /\b(speed|how fast)\b/) && !motionOf(c)) { flush(); out.push({ t: 'reply', text: '§speed' }); continue; }
    if (has(c, /\b(status|report|how are you|sitrep|diagnos|check)\b/)) { flush(); out.push({ t: 'reply', text: '§status' }); continue; }
    if (has(c, /\b(list|what|show)\b.*\bmissions?\b/)) { flush(); out.push({ t: 'reply', text: '§missions' }); continue; }
    // settings
    const trim = c.match(/\btrim(?: steering)?(?: to)? (left|right)?\s*([+-]?\d+)/);
    if (trim) { const v = Math.max(-20, Math.min(20, (trim[1] === 'left' ? -1 : 1) * Math.abs(+trim[2]) * (trim[2].startsWith('-') ? -1 : 1))); flush(); out.push({ t: 'set', patch: { trim: v }, say: `Steering trim set to ${v > 0 ? '+' : ''}${v}.` }); continue; }
    const maxp = c.match(/\b(?:max(?:imum)? power|power limit|limit power)(?: to)? (\d+)/);
    if (maxp) { const v = Math.max(20, Math.min(100, +maxp[1])); flush(); out.push({ t: 'set', patch: { maxPower: v }, say: `Max power limited to ${v}%.` }); continue; }
    if (has(c, /\bdark (mode|theme)\b/)) { flush(); out.push({ t: 'theme', v: 'dark' }); continue; }
    if (has(c, /\blight (mode|theme)\b/)) { flush(); out.push({ t: 'theme', v: 'light' }); continue; }
    const toggles: [RegExp, keyof Settings, string][] = [[/\btilt( steering)?\b/, 'steerSource', 'Tilt steering'], [/\b(engine|motor) sounds?\b/, 'motorSound', 'Motor sound'], [/\bhaptics?|vibration\b/, 'haptics', 'Haptics'], [/\b(sounds?|chimes?)\b/, 'uiSounds', 'Sounds'], [/\b(voice replies|talk back|speak)\b/, 'speakReplies', 'Spoken replies'], [/\btips\b/, 'novaTips', 'Tips']];
    const tog = toggles.find(([re]) => re.test(c));
    if (tog && has(c, /\b(on|off|enable|disable|use|stop using|activate|deactivate)\b/)) {
      const on = !has(c, /\b(off|disable|stop using|deactivate|no)\b/);
      const patch = (tog[1] === 'steerSource' ? { steerSource: on ? 'tilt' : 'touch' } : { [tog[1]]: on }) as Partial<Settings>;
      flush(); out.push({ t: 'set', patch, say: `${tog[2]} ${on ? 'on' : 'off'}.` }); continue;
    }
    if (has(c, /\b(map|trail|radar)\b/) && has(c, /\b(show|open|switch|view)\b/)) { flush(); out.push({ t: 'set', patch: { hudView: 'map' }, say: 'Showing the trail map.' }); continue; }
    if (has(c, /\b(camera|fpv)\b/) && has(c, /\b(show|open|switch|view)\b/)) { flush(); out.push({ t: 'set', patch: { hudView: 'camera' }, say: 'Camera view.' }); continue; }
    if (has(c, /\b(gauge|gauges|speedometer|dials?)\b/)) { flush(); out.push({ t: 'set', patch: { hudView: 'gauge' }, say: 'Showing the gauges.' }); continue; }
    // navigation
    const nav = c.match(/\b(?:open|show|go to|take me to|switch to)(?: the)? (garage|home|build|build guide|wiring|circuit|parts|cockpit|drive|missions?|logs?|academy|school|achievements|settings|nova|chat)\b/);
    if (nav) {
      const k = nav[1];
      const to: NavTarget = k === 'home' || k === 'garage' ? 'garage' : k.startsWith('build') || k === 'wiring' || k === 'circuit' || k === 'parts' ? 'build' : k.startsWith('mission') ? 'missions' : k.startsWith('log') ? 'logs' : k === 'school' || k === 'achievements' || k === 'academy' ? 'academy' : k === 'cockpit' || k === 'drive' ? 'drive' : k === 'settings' ? 'settings' : 'nova';
      flush(); out.push({ t: 'nav', to }); continue;
    }
    // chit-chat & help
    if (has(c, /\b(help|what can you do|commands|how do i|examples?)\b/)) { flush(); out.push({ t: 'reply', text: '§help' }); continue; }
    if (has(c, /^(hi|hello|hey|yo|good (morning|evening|afternoon)|namaste)\b/)) { flush(); out.push({ t: 'reply', text: '§hello' }); continue; }
    if (has(c, /\b(thanks|thank you|nice|great job|good job|awesome|cool)\b/)) { flush(); out.push({ t: 'reply', text: '§thanks' }); continue; }
    if (has(c, /\b(who are you|your name)\b/)) { flush(); out.push({ t: 'reply', text: "I'm Nova, MARK 1's onboard co-pilot. I run fully offline on this device." }); continue; }
    // motion
    const st = motionOf(c);
    if (st) { motion.push(st); continue; }
    if (has(c, /\b(pause|wait|hold)\b/)) { const ms = durationOf(c, 0) ?? 1000; motion.push({ id: sid(), kind: 'move', move: 'wait', speed: 0, ms }); continue; }
    flush(); out.push({ t: 'reply', text: `§unknown:${c}` });
  }
  flush();
  return out;
}

/* ── answers built from live data ──────────────────────────────── */
function answer(key: string): string {
  const r = rover.get(); const { tel } = r; const live = r.status === 'connected';
  const off = "I'm not connected to a rover yet — tap Connect or Try demo in the Garage.";
  switch (key) {
    case 'battery':
      if (!live) return off;
      if (tel.pct == null) return 'MARK 1 has no battery sensor yet — it arrives with the Phase 4 voltage divider.';
      return `Battery is at ${tel.pct}%, ${tel.vbat?.toFixed(2)} volts${tel.estMin != null ? `, about ${tel.estMin} minutes of driving left` : ''}.${tel.pct <= 30 ? ' I suggest Crawl or Cruise mode to stretch it.' : ''}`;
    case 'signal':
      if (!live) return off;
      return `${tel.rssi != null ? `Signal ${tel.rssi} dBm — ${tel.rssi > -60 ? 'excellent' : tel.rssi > -70 ? 'good' : 'weak, come closer'}. ` : 'Link is up. '}${r.latency != null ? `Round-trip latency ${r.latency} ms.` : ''}`;
    case 'runtime':
      if (!live) return off;
      return tel.estMin != null ? `At this pace you have roughly ${tel.estMin} minutes left.` : "I'm still learning your drain rate — drive for a minute and ask again.";
    case 'distance': { const o = odo.get(); return `This session: about ${o.dist.toFixed(1)} meters, top speed ${(o.maxSpeed * 3.6).toFixed(1)} km/h (estimated).`; }
    case 'speed': return live ? `Output is ${Math.abs(tel.thr)}% ${tel.thr < 0 ? 'in reverse' : ''}, roughly ${(odo.get().speed * 3.6).toFixed(1)} km/h.` : off;
    case 'status':
      if (!live) return off;
      return `All systems ${tel.warn.length ? 'nominal, with warnings: ' + tel.warn.join(', ') : 'nominal'}. Ignition ${tel.armed ? 'on' : 'off'}, ${modeSpec(tel.mode).label} mode, battery ${tel.pct ?? '—'}%, link ${r.kind === 'demo' ? 'demo' : r.kind === 'http' ? 'basic' : 'full'}.`;
    case 'missions': return `You have ${allMissions().length} missions: ${allMissions().slice(0, 8).map((m) => m.name).join(', ')}${allMissions().length > 8 ? '…' : ''}. Say “run” and a name.`;
    case 'help': return 'Try: “forward slowly for 2 seconds then turn right” · “reverse 1 meter” · “faster” / “slower” · “sport mode” · “hold speed” · “run the figure 8” · “camera view” · “take a photo” · “record video” · “battery?” · “status report” · “trim left 3” · “stop”.';
    case 'hello': return `Hello! ${rover.get().status === 'connected' ? `MARK 1 is ${rover.get().tel.armed ? 'armed and ready' : 'online — say “start engine” when ready'}.` : 'Connect to MARK 1 or try the demo and we can roll.'}`;
    case 'thanks': return 'Any time. Drive safe!';
  }
  if (key.startsWith('unknown:')) return `I didn't understand “${key.slice(8)}”. Say “help” for examples.`;
  return key;
}

/* ── execution ─────────────────────────────────────────────────── */
let lastSource: 'typed' | 'voice' = 'typed';
export type Speaker = (text: string) => void;
let speaker: Speaker = () => {};
export function setSpeaker(fn: Speaker) { speaker = fn; }

/** Instant stop path used by voice partial results and the Stop chip. */
export function hardStop() { stopMission('voice stop', true); input.set({ thr: 0, str: 0 }); }

export function ask(text: string, source: 'typed' | 'voice' = 'typed'): string {
  const t = text.trim();
  if (!t) return '';
  lastSource = source;
  push('you', t, { source });
  logEvent(source === 'voice' ? 'voice' : 'nova', `${source === 'voice' ? '🎙' : '⌨'} “${t}”`);
  bus.emit('command', { text: t, source });

  if (t.startsWith('/raw ')) return say(rawCommand(t.slice(5)));
  const actions = parse(t);
  const replies: string[] = [];
  const r = rover.get();
  const live = r.status === 'connected';
  let armedNow = r.tel.armed;
  let tone: ChatMsg['tone'] = 'neutral';
  /** Driving requests switch the ignition on themselves — asking Nova to drive is consent. */
  const ensureArmed = () => {
    if (armedNow) return true;
    if (!live) return false;
    control.arm(); armedNow = true; replies.push('Ignition on.');
    return true;
  };

  for (const a of actions) {
    switch (a.t) {
      case 'stop': hardStop(); replies.push('Stopping.'); tone = 'warn'; break;
      case 'estop': stopMission('emergency', true); control.estop(); replies.push('Emergency stop! Motors cut — slide to start again when safe.'); tone = 'bad'; break;
      case 'arm': if (!live) { replies.push("I can't start the engine — no rover is connected."); break; }
        control.arm(); armedNow = true; replies.push('Ignition on. Motors armed.'); tone = 'good'; break;
      case 'disarm': stopMission('ignition off', true); control.disarm(); armedNow = false; replies.push('Ignition off.'); break;
      case 'mode': control.mode(a.m); replies.push(`${modeSpec(a.m).label} mode — power cap ${modeSpec(a.m).cap}%.`); break;
      case 'steps': {
        if (!live) { replies.push("I'd drive, but no rover is connected. Tap Connect or Try demo in the Garage."); tone = 'warn'; break; }
        ensureArmed();
        const m = quickMission(describeSteps(a.steps), a.steps);
        const go = () => { const res = runMission(m); if (!res.ok) say(res.reason!, 'warn'); };
        if (armedNow && !r.tel.armed) setTimeout(go, 350); else go();
        replies.push(`On it: ${describeSteps(a.steps)}.`); tone = 'good'; break;
      }
      case 'mission': {
        const m = findMission(a.name);
        if (!m) { replies.push(`I can't find a mission called “${a.name}”.`); break; }
        if (!live) { replies.push(`“${m.name}” needs a connected rover.`); break; }
        ensureArmed();
        const go = () => { const res = runMission(m); if (!res.ok) say(res.reason!, 'warn'); };
        if (!r.tel.armed) setTimeout(go, 350); else go();
        replies.push(`Running “${m.name}” — ${m.desc.toLowerCase()}. Touch any control to take over.`); tone = 'good'; break;
      }
      case 'record': if (recorder.get().on) replies.push('Already recording.'); else { startRecording(); replies.push('Recording your drive. Say “stop recording” to save it as a mission.'); } break;
      case 'saveRecord': { const m = stopRecording(true); replies.push(m ? `Saved as “${m.name}” in Missions.` : 'Nothing to save — the recording was empty.'); break; }
      case 'replay': {
        const m = allMissions().find((x) => x.recorded);
        if (!m) { replies.push('No recorded drives yet — say “record a drive” first.'); break; }
        if (!live) { replies.push('Connect to the rover first, then I can replay it.'); break; }
        const wasArmed = r.tel.armed; ensureArmed();
        const res = wasArmed ? runMission(m) : (setTimeout(() => { const x = runMission(m); if (!x.ok) say(x.reason!, 'warn'); }, 350), { ok: true }); replies.push(res.ok ? `Replaying “${m.name}”.` : res.reason!); break;
      }
      case 'set': settings.set(a.patch); replies.push(a.say); break;
      case 'hold': {
        if (!a.on) { control.cruiseOff('Nova'); replies.push('Speed hold off.'); break; }
        if (cruise.get().on) { replies.push(`Already holding ${Math.abs(cruise.get().thr)}%.`); break; }
        control.cruise();
        replies.push(cruise.get().on ? `Holding ${Math.abs(cruise.get().thr)}% — steer freely, touch the throttle to take back control.` : 'Drive at the speed you want first, then ask me to hold it.');
        break;
      }
      case 'shift': {
        const i = MODES.findIndex((x) => x.id === rover.get().tel.mode);
        const n = MODES[Math.max(0, Math.min(MODES.length - 1, i + a.dir))];
        if (n.id === rover.get().tel.mode) { replies.push(a.dir > 0 ? `Already in ${n.label}, the top mode.` : `Already in ${n.label}, the gentlest mode.`); break; }
        control.mode(n.id); replies.push(`${n.label} mode — power cap ${n.cap}%.`); break;
      }
      case 'photo': settings.set({ hudView: 'camera' }); setTimeout(snapshot, 250); replies.push(hasCamera() ? 'Snapshot!' : 'Connect a camera first.'); break;
      case 'video':
        if (a.on) { if (capture.get().clip) replies.push('Already filming.'); else if (!hasCamera()) { settings.set({ hudView: 'camera' }); replies.push('Connect a camera first.'); } else { settings.set({ hudView: 'camera' }); setTimeout(startClip, 250); replies.push('Filming. Say “stop video” to save it to the Gallery.'); } }
        else { if (capture.get().clip) { stopClip(); replies.push('Saving the clip to the Gallery.'); } else replies.push('Not filming right now.'); }
        break;
      case 'theme': LiquidGlass.theme.set(a.v); window.dispatchEvent(new CustomEvent('rcr-theme')); replies.push(`${a.v === 'dark' ? 'Dark' : 'Light'} theme on.`); break;
      case 'nav': nova.set({ navRequest: a.to }); replies.push(`Opening ${a.to === 'nova' ? 'chat' : a.to}.`); break;
      case 'reply': replies.push(a.text.startsWith('§') ? answer(a.text.slice(1)) : a.text); if (a.text.startsWith('§unknown')) tone = 'warn'; break;
    }
  }
  return say(replies.filter(Boolean).join(' ') || answer('help'), tone);
}

function say(text: string, tone: ChatMsg['tone'] = 'neutral') {
  push('nova', text, { tone });
  logEvent('nova', `Nova: ${text}`, tone === 'bad' ? 'bad' : tone === 'warn' ? 'warn' : 'neutral');
  if (settings.get().speakReplies && lastSource === 'voice') speaker(text);
  return text;
}

function describeSteps(steps: Step[]) {
  const words = steps.map((s) => {
    if (s.kind !== 'move') return '';
    const what = { forward: 'forward', back: 'reverse', left: 'forward-left', right: 'forward-right', backleft: 'reverse-left', backright: 'reverse-right', spinleft: 'tight left', spinright: 'tight right', wait: 'pause' }[s.move];
    return `${what}${s.move !== 'wait' ? ` at ${Math.round(s.speed)}%` : ''} for ${(s.ms / 1000).toFixed(1)} s`;
  }).filter(Boolean);
  return words.join(', then ');
}

function rawCommand(json: string): string {
  try {
    const m = JSON.parse(json) as { t?: string };
    if (!m || typeof m.t !== 'string') return 'Raw commands need a "t" field, e.g. /raw {"t":"mode","m":"sport"}';
    if (m.t === 'arm') control.arm(); else if (m.t === 'disarm') control.disarm(); else if (m.t === 'estop') control.estop();
    else if (m.t === 'mode') control.mode((m as { m: DriveMode }).m);
    else return `Raw “${m.t}” is not allowed from the console (drive goes through the controls).`;
    return `Sent raw ${json}`;
  } catch { return 'That is not valid JSON.'; }
}

export function clearChat() { nova.set({ messages: [] }); }
export function consumeNav() { const n = nova.get().navRequest; if (n) nova.set({ navRequest: null }); return n; }

/* ── proactive tips (rate-limited) ─────────────────────────────── */
const lastTip: Record<string, number> = {};
function tip(key: string, text: string, tone: ChatMsg['tone'] = 'warn', speak = false) {
  if (!settings.get().novaTips) return;
  const now = Date.now();
  if (lastTip[key] && now - lastTip[key] < 90000) return;
  lastTip[key] = now;
  push('nova', text, { tone, source: 'tip' });
  logEvent('nova', `Tip: ${text}`, tone === 'bad' ? 'bad' : 'warn');
  toast(text, tone === 'bad' ? 'bad' : 'warn', 3200);
  if (speak && settings.get().speakReplies) speaker(text);
}
rover.subscribe(() => {
  const r = rover.get(); if (r.status !== 'connected') return;
  const { tel } = r;
  if (tel.pct != null && tel.pct <= 15) tip('bat15', `Battery critical at ${tel.pct}%. Head back and park.`, 'bad', true);
  else if (tel.pct != null && tel.pct <= 30 && (tel.mode === 'sport' || tel.mode === 'full')) tip('bat30', `Battery ${tel.pct}% — Cruise mode will stretch your range.`);
  if (tel.rssi != null && tel.rssi < -75) tip('rssi', `Weak signal (${tel.rssi} dBm). Stay closer to MARK 1.`, 'warn', true);
  if (r.latency != null && r.latency > 180) tip('lat', `High latency (${r.latency} ms). Controls may feel delayed.`);
});
bus.on('rover', ({ e }) => {
  if (e === 'failsafe') tip('fs', 'Failsafe kicked in — MARK 1 stopped because it lost your commands.', 'warn', true);
  if (e === 'cutoff') tip('cut', 'Battery cutoff: motors disabled to protect the cells.', 'bad', true);
});
bus.on('connected', ({ kind }) => {
  push('nova', kind === 'demo' ? 'Demo rover online. Slide to start, then drive — or ask me to “do a figure 8”.' : kind === 'http' ? 'Connected in basic mode (Firmware V1): simple directions work; speed control arrives with Firmware V3.' : 'MARK 1 online. All systems go.', { tone: 'good', source: 'tip' });
});
bus.on('achievement', ({ title }) => push('nova', `Achievement unlocked: ${title}! 🏅`, { tone: 'good', source: 'tip' }));
export const novaHaptic = () => haptic('tick');
