/* In-app updates. Checks the project's GitHub Releases for a newer RC-Rovers build;
   on Android it downloads the APK and opens the system "Update this app?" screen
   (same signing key + higher versionCode ⇒ installs over the old app, data kept).
   On the web it just links the download. Fails quietly when offline (e.g. while on
   the rover's own Wi-Fi). */
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { createStore } from '../state/store';
import { toast } from '../state/ui';
import { logEvent } from '../state/logs';
import { APP_VERSION } from '../rover/protocol';

const REPO = 'thrishankkuntimaddi/my-rovers';
const TAG = /^rc-rovers-v(\d+)\.(\d+)\.(\d+)$/;

interface UpdaterPlugin {
  canInstall(): Promise<{ allowed: boolean }>;
  openInstallSettings(): Promise<void>;
  downloadAndInstall(o: { url: string }): Promise<{ bytes: number }>;
  addListener(e: 'progress', fn: (p: { received: number; total: number }) => void): Promise<PluginListenerHandle>;
}
const Updater = registerPlugin<UpdaterPlugin>('Updater');

export type UpdState = 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'installing' | 'error';
export const update = createStore<{ state: UpdState; latest: string | null; notes: string; url: string | null; progress: number; error: string | null }>(
  { state: 'idle', latest: null, notes: '', url: null, progress: 0, error: null });

const parse = (v: string) => v.split('.').map((n) => parseInt(n, 10) || 0);
export function newer(a: string, b: string) {
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}

interface GhRelease { tag_name: string; draft: boolean; prerelease: boolean; body: string; assets: { name: string; browser_download_url: string }[] }

export async function checkForUpdate(manual = false) {
  if (update.get().state === 'downloading' || update.get().state === 'installing') return;
  update.set({ state: 'checking', error: null });
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=20`, { signal: ctl.signal, headers: { Accept: 'application/vnd.github+json' } });
    clearTimeout(t);
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    const list = (await res.json()) as GhRelease[];
    let best: { v: string; r: GhRelease } | null = null;
    for (const r of list) {
      const m = TAG.exec(r.tag_name);
      if (!m || r.draft || r.prerelease) continue;
      const v = `${m[1]}.${m[2]}.${m[3]}`;
      if (!best || newer(v, best.v)) best = { v, r };
    }
    const apk = best?.r.assets.find((a) => a.name === 'RC-Rovers.apk') ?? best?.r.assets.find((a) => a.name.endsWith('.apk'));
    if (best && apk && newer(best.v, APP_VERSION)) {
      update.set({ state: 'available', latest: best.v, notes: best.r.body.trim(), url: apk.browser_download_url });
      if (!manual) toast(`RC-Rovers ${best.v} is available. Open Settings or the Garage to update.`, 'good', 3600);
    } else {
      update.set({ state: 'current', latest: best?.v ?? APP_VERSION });
      if (manual) toast(`You're on the latest version (${APP_VERSION})`, 'good');
    }
  } catch (e) {
    update.set({ state: manual ? 'error' : 'idle', error: manual ? 'No internet. If you are on the rover Wi-Fi, switch to a network with internet.' : null });
    if (manual) toast('Could not check for updates (no internet?)', 'warn');
    void e;
  }
}

export async function installUpdate() {
  const { url, latest } = update.get();
  if (!url) return;
  if (!Capacitor.isNativePlatform()) { window.open(url, '_blank'); return; }
  try {
    const { allowed } = await Updater.canInstall();
    if (!allowed) {
      toast('Allow "Install unknown apps" for RC-Rovers, then tap Update again', 'warn', 4200);
      await Updater.openInstallSettings();
      return;
    }
    update.set({ state: 'downloading', progress: 0, error: null });
    const sub = await Updater.addListener('progress', (p) => update.set({ progress: p.total > 0 ? p.received / p.total : 0 }));
    try { await Updater.downloadAndInstall({ url }); } finally { sub.remove(); }
    update.set({ state: 'installing', progress: 1 });
    logEvent('system', `Update ${latest} downloaded; installer opened`, 'good');
  } catch (e) {
    update.set({ state: 'available', error: String((e as Error)?.message ?? e) });
    toast('Update download failed. Check your internet and try again.', 'bad');
  }
}

/** Quiet check shortly after launch (Android app only). */
export function autoCheck() {
  if (!Capacitor.isNativePlatform()) return;
  setTimeout(() => checkForUpdate(false), 2500);
}
