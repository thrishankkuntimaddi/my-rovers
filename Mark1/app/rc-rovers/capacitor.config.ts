import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.myrovers.rcrovers',
  appName: 'RC-Rovers',
  webDir: 'dist',
  // The rover speaks plain http:// and ws:// on its own Wi-Fi (192.168.4.1),
  // so the app must not be served over https (mixed content would be blocked).
  server: { androidScheme: 'http', cleartext: true },
  android: { backgroundColor: '#EEF0F6' },
  plugins: {
    // Native HTTP for fetch(): no CORS restrictions when talking to the rover.
    CapacitorHttp: { enabled: true },
    SplashScreen: { launchAutoHide: true, launchShowDuration: 700, launchFadeOutDuration: 250, backgroundColor: '#EEF0F6', showSpinner: false },
    StatusBar: { overlaysWebView: true },
  },
};

export default config;
