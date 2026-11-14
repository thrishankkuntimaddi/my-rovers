/* Voice I/O: hold-to-talk recognition + spoken replies.
   Android → native SpeechRecognizer / TextToSpeech (Capacitor plugins).
   Browser → Web Speech API. A spoken “stop” acts on the *partial* transcript,
   i.e. before you finish talking. */
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';
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

export const voice = createStore<{ supported: boolean | null; listening: boolean; partial: string; speaking: boolean }>(
  { supported: null, listening: false, partial: '', speaking: false }, { batched: true });

const native = Capacitor.isNativePlatform();

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
let handles: PluginListenerHandle[] = [];
let finalized = true;
let stopFired = false;

export async function checkVoice(): Promise<boolean> {
  if (voice.get().supported != null) return voice.get().supported!;
  let ok = false;
  if (native) { try { ok = (await SpeechRecognition.available()).available; } catch { ok = false; } }
  else ok = !!WebRecCtor();
  voice.set({ supported: ok });
  return ok;
}

function onPartial(text: string) {
  voice.set({ partial: text });
  const t = text.toLowerCase();
  if (!stopFired && /\b(emergency|abort)\b/.test(t)) { stopFired = true; control.estop(); haptic('heavy'); }
  else if (!stopFired && /\b(stop|halt|freeze|brake)\b/.test(t) && !/\brecord/.test(t)) { stopFired = true; hardStop(); haptic('medium'); }
}

function finalize() {
  if (finalized) return;
  finalized = true;
  const text = voice.get().partial.trim();
  voice.set({ listening: false });
  if (text) { bus.emit('voice', { text }); ask(text, 'voice'); }
  setTimeout(() => voice.set({ partial: '' }), 2500);
}

export async function startListening() {
  if (voice.get().listening) return;
  if (!(await checkVoice())) {
    toast(native ? 'Speech recognition is not available on this device' : 'Voice needs Chrome (Web Speech API)', 'warn');
    return;
  }
  stopTalking();
  finalized = false; stopFired = false;
  voice.set({ listening: true, partial: '' });
  chime('listen'); haptic('light');
  const lang = settings.get().voiceLang;
  try {
    if (native) {
      const perm = await SpeechRecognition.checkPermissions();
      if (perm.speechRecognition !== 'granted') {
        const req = await SpeechRecognition.requestPermissions();
        if (req.speechRecognition !== 'granted') throw new Error('Microphone permission denied');
      }
      for (const h of handles) h.remove(); handles = [];
      handles.push(await SpeechRecognition.addListener('partialResults', (d) => { if (d.matches?.[0]) onPartial(d.matches[0]); }));
      handles.push(await SpeechRecognition.addListener('listeningState', (d) => { if (d.status === 'stopped') setTimeout(finalize, 150); }));
      await SpeechRecognition.start({ language: lang, partialResults: true, popup: false, maxResults: 1 });
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
    toast(String((e as Error).message || e), 'bad');
    logEvent('voice', `Voice error: ${String((e as Error).message || e)}`, 'bad');
  }
}

export async function stopListening() {
  if (!voice.get().listening) return;
  try { if (native) await SpeechRecognition.stop(); else webRec?.stop(); } catch { /* ignore */ }
  setTimeout(finalize, native ? 450 : 900);   // give the recognizer a moment to deliver the tail
}

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
