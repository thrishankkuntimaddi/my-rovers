package com.myrovers.rcrovers;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * In-app updates: downloads a newer RC-Rovers APK and opens Android's
 * "Do you want to update this app?" screen. Because every release is signed with
 * the same key and has a higher versionCode, it installs over the current app and
 * keeps all data. Emits "progress" events {received, total} while downloading.
 */
@CapacitorPlugin(name = "Updater")
public class UpdaterPlugin extends Plugin {

    /** Whether Android lets this app open the installer (Install unknown apps). */
    @PluginMethod
    public void canInstall(PluginCall call) {
        JSObject r = new JSObject();
        boolean ok = Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getContext().getPackageManager().canRequestPackageInstalls();
        r.put("allowed", ok);
        call.resolve(r);
    }

    /** Opens the "Install unknown apps" setting for RC-Rovers. */
    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
        }
        call.resolve();
    }

    /** Downloads `url` (follows GitHub's redirects) and launches the installer. */
    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !url.startsWith("https://")) { call.reject("A https URL is required"); return; }
        call.setKeepAlive(true);
        new Thread(() -> {
            try {
                File dir = new File(getContext().getCacheDir(), "updates");
                if (!dir.exists() && !dir.mkdirs()) throw new Exception("Cannot create cache folder");
                File apk = new File(dir, "RC-Rovers-update.apk");
                HttpURLConnection c = open(url, 0);
                long total = c.getContentLengthLong();
                try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(apk)) {
                    byte[] buf = new byte[64 * 1024];
                    long got = 0, lastEmit = 0;
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        out.write(buf, 0, n);
                        got += n;
                        if (got - lastEmit > 256 * 1024 || got == total) {
                            lastEmit = got;
                            JSObject p = new JSObject();
                            p.put("received", got);
                            p.put("total", total);
                            notifyListeners("progress", p);
                        }
                    }
                } finally { c.disconnect(); }

                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
                Intent i = new Intent(Intent.ACTION_VIEW);
                i.setDataAndType(uri, "application/vnd.android.package-archive");
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(i);
                JSObject r = new JSObject();
                r.put("bytes", apk.length());
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Update download failed: " + e.getMessage());
            }
        }).start();
    }

    private HttpURLConnection open(String url, int hops) throws Exception {
        if (hops > 6) throw new Exception("Too many redirects");
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setInstanceFollowRedirects(false);
        c.setConnectTimeout(15000);
        c.setReadTimeout(30000);
        c.setRequestProperty("User-Agent", "RC-Rovers-Updater");
        int code = c.getResponseCode();
        if (code >= 300 && code < 400) {
            String loc = c.getHeaderField("Location");
            c.disconnect();
            if (loc == null || !loc.startsWith("https://")) throw new Exception("Bad redirect");
            return open(loc, hops + 1);
        }
        if (code != 200) throw new Exception("HTTP " + code);
        return c;
    }
}
