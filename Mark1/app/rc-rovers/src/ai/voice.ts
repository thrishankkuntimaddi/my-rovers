/* Voice I/O for Nova.
   Android → our native Voice plugin (VoicePlugin.java): on-device recognition first, so it
   works on the rover's Wi-Fi without internet; spoken replies via TextToSpeech.
   Browser → Web Speech API.
   Tap the mic to talk (it stops by itself when you pause), or hold it for push-to-talk.
   A spoken “stop” acts on the partial transcript, before you finish talking. */
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { createStore } from '../state/store';
import { settings } from '../state/settings';
import { toast } from '../state/ui';
import { logEvent } from '../state/logs';
import { bus } from '../state/bus';
import { chime } from '../lib/sound';
import { haptic } from '../lib/native';
import { control } from '../rover/controller';
import { ask, hardStop, setSpeaker } from './copilot';

export const voice = createStore<{ supported: boolean | null; listening: boolean; partial: string; speaking: boolean; level: number; offline: boolean }>(
  { supported: null, listening: false, partial: '', speaking: false, level: 0, offline: false }, { batched: true });

const native = Capacitor.isNativePlatform();

interface VoiceNative {
  available(): Promise<{ available: boolean; onDevice: boolean }>;
  start(o: { lang: string }): Promise<void>;
  stop(): Promise<void>;
  cancel(): Promise<void>;
  addListener(e: 'partial', f: (d: { text: string }) => void): Promise<PluginListenerHandle>;
  addListener(e: 'final', f: (d: { text: string; alts: string[] }) => void): Promise<PluginListenerHandle>;
  addListener(e: 'error', f: (d: { code: number; onDevice: boolean }) => void): Promise<PluginListenerHandle>;
  addListener(e: 'state', f: (d: { listening: boolean; onDevice: boolean }) => void): Promise<PluginListenerHandle>;
  addListener(e: 'level', f: (d: { rms: number }) => void): Promise<PluginListenerHandle>;
}
const Voice = registerPlugin<VoiceNative>('Voice');

interface WebRec {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null;
  start(): void; stop(): void; abort(): void;
}
const WebRecCtor = (): (new () => WebRec) | null => {
  const w = window as unknown as { SpeechRecognition?: new () => WebRec; webkitSpeechRecognition?: new () => WebRec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

let webRec: WebRec | null = null;
let finalized = true;
let stopFired = false;
let tailTimer: ReturnType<typeof setTimeout> | null = null;

/* Native error codes (android.speech.SpeechRecognizer) → what to tell the driver. */
const NATIVE_ERRORS: Record<number, [string, 'warn' | 'bad' | 'quiet']> = {
  1: ['Voice needs the offline English pack on the rover’s Wi-Fi: Android Settings → Google → Voice → Offline speech recognition → download English.', 'bad'],
  2: ['Voice needs the offline English pack on the rover’s Wi-Fi: Android Settings → Google → Voice → Offline speech recognition → download English.', 'bad'],
  3: ['The microphone is busy in another app.', 'bad'],
  4: ['The speech service had a problem. Try again.', 'warn'],
  5: ['', 'quiet'],
  6: ['I didn’t hear anything. Tap the mic and speak.', 'warn'],
  7: ['I didn’t catch that. Try again, a little slower.', 'warn'],
  8: ['Voice is busy, try again in a second.', 'warn'],
  9: ['Allow the microphone for RC-Rovers in Android settings.', 'bad'],
  11: ['The speech service disconnected. Try again.', 'warn'],
  12: ['This voice language isn’t installed. Pick US/UK/India in Settings → Nova, or download it in Google → Voice.', 'bad'],
  13: ['The voice language pack is still downloading. Try again in a minute.', 'warn'],
};

let wired: Promise<void> | null = null;
function wireNative() {
  if (wired) return wired;
  wired = (async () => {
    await Voice.addListener('partial', (d) => onPartial(d.text));
    await Voice.addListener('final', (d) => { if (d.text) voice.set({ partial: d.text }); finalize(); });
    await Voice.addListener('state', (d) => { voice.set({ offline: d.onDevice }); if (!d.listening) scheduleTail(1600); });
    await Voice.addListener('level', (d) => voice.set({ level: Math.max(0, Math.min(1, (d.rms + 2) / 12)) }));
    await Voice.addListener('error', (d) => {
      const [msg, tone] = NATIVE_ERRORS[d.code] ?? [`Voice error ${d.code}`, 'warn'];
      if (voice.get().partial.trim() && (d.code === 6 || d.code === 7)) { finalize(); return; }   // we already heard something
      finalized = true;
      voice.set({ listening: false, level: 0 });
      if (tone !== 'quiet') { toast(msg, tone === 'bad' ? 'bad' : 'warn', tone === 'bad' ? 6000 : 2600); logEvent('voice', `Voice: ${msg}`, tone === 'bad' ? 'bad' : 'warn'); }
    });
  })();
  return wired;
}

export async function checkVoice(): Promise<boolean> {
  if (voice.get().supported != null) return voice.get().supported!;
  let ok = false;
  if (native) { try { const a = await Voice.available(); ok = a.available; voice.set({ offline: a.onDevice }); } catch { ok = false; } }
  else ok = !!WebRecCtor();
  voice.set({ supported: ok });
  return ok;
}

function onPartial(text: string) {
  voice.set({ partial: text });
  const t = text.toLowerCase();
  if (!stopFired && /\b(emergency|abort)\b/.test(t)) { stopFired = true; control.estop(); haptic('heavy'); }
  else if (!stopFired && /\b(stop|halt|freeze|brake)\b/.test(t) && !/\b(record|video|recording)/.test(t)) { stopFired = true; hardStop(); haptic('medium'); }
}

function scheduleTail(ms: number) {
  if (tailTimer) clearTimeout(tailTimer);
  tailTimer = setTimeout(finalize, ms);   // safety net if the recognizer never sends a final result
}

function finalize() {
  if (tailTimer) { clearTimeout(tailTimer); tailTimer = null; }
  if (finalized) return;
  finalized = true;
  const text = voice.get().partial.trim();
  voice.set({ listening: false, level: 0 });
  if (text) { bus.emit('voice', { text }); ask(text, 'voice'); }
  setTimeout(() => { if (finalized) voice.set({ partial: '' }); }, 2500);
}

export async function startListening() {
  if (voice.get().listening) return;
  if (!(await checkVoice())) {
    toast(native ? 'Speech recognition is not available on this device. Install or update the Google app.' : 'Voice needs Chrome (Web Speech API)', 'warn', 4000);
    return;
  }
  stopTalking();
  finalized = false; stopFired = false;
  voice.set({ listening: true, partial: '' });
  chime('listen'); haptic('light');
  const lang = settings.get().voiceLang;
  try {
    if (native) {
      await wireNative();
      await Voice.start({ lang });
      scheduleTail(12000);
    } else {
      const Ctor = WebRecCtor()!;
      webRec = new Ctor();
      webRec.lang = lang; webRec.interimResults = true; webRec.continuous = false; webRec.maxAlternatives = 1;
      webRec.onresult = (e) => { let s = ''; for (let i = 0; i < e.results.length; i++) s += e.results[i][0].transcript; onPartial(s); };
      webRec.onend = () => finalize();
      webRec.onerror = (e) => { if (e.error !== 'no-speech' && e.error !== 'aborted') toast(`Voice: ${e.error}`, 'warn'); };
      webRec.start();
    }
    logEvent('voice', 'Listening…');
  } catch (e) {
    finalized = true;
    voice.set({ listening: false });
    const msg = String((e as Error).message || e);
    toast(/denied/i.test(msg) ? 'Allow the microphone to talk to Nova' : msg, 'bad');
    logEvent('voice', `Voice error: ${msg}`, 'bad');
  }
}

/** Finish now and act on what was heard (push-to-talk release, or tapping the mic again). */
export async function stopListening() {
  if (!voice.get().listening) return;
  try { if (native) await Voice.stop(); else webRec?.stop(); } catch { /* ignore */ }
  scheduleTail(native ? 1500 : 900);   // the final result normally arrives well before this
}

export function toggleListening() { if (voice.get().listening) stopListening(); else startListening(); }

/* ── speaking ──────────────────────────────────────────────────── */
export function speak(text: string) {
  const clean = text.replace(/[“”]/g, '"').replace(/[^\p{L}\p{N}\s.,!?%'"+-]/gu, ' ');
  voice.set({ speaking: true });
  const done = () => voice.set({ speaking: false });
  if (native) {
    TextToSpeech.speak({ text: clean, lang: settings.get().voiceLang, rate: 1.04, pitch: 1.0, volume: 1.0 }).then(done, done);
    return;
  }
  try {
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = settings.get().voiceLang; u.rate = 1.04; u.onend = done; u.onerror = done;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  } catch { done(); }
}
export function stopTalking() {
  if (!voice.get().speaking) return;
  if (native) TextToSpeech.stop().catch(() => {}); else try { speechSynthesis.cancel(); } catch { /* ignore */ }
  voice.set({ speaking: false });
}

setSpeaker(speak);
