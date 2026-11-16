package com.myrovers.rcrovers;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Camera snapshots and clips go to the Gallery: Pictures/RC-Rovers and Movies/RC-Rovers.
 * The web layer writes the file to the app cache first, then calls saveToGallery with its
 * file:// URI. No storage permission is needed on Android 10+ (MediaStore).
 */
@CapacitorPlugin(name = "Media")
public class MediaPlugin extends Plugin {

    @PluginMethod
    public void saveToGallery(PluginCall call) {
        String path = call.getString("path");
        String name = call.getString("name", "rc-rovers");
        String mime = call.getString("mime", "image/png");
        if (path == null) { call.reject("path is required"); return; }
        boolean video = mime.startsWith("video/");
        new Thread(() -> {
            File src = new File(Uri.parse(path).getPath());
            try {
                if (!src.exists()) throw new Exception("File not found");
                Uri out;
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentResolver cr = getContext().getContentResolver();
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                    v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                    v.put(MediaStore.MediaColumns.RELATIVE_PATH, (video ? Environment.DIRECTORY_MOVIES : Environment.DIRECTORY_PICTURES) + "/RC-Rovers");
                    v.put(MediaStore.MediaColumns.IS_PENDING, 1);
                    Uri coll = video
                        ? MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                        : MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
                    out = cr.insert(coll, v);
                    if (out == null) throw new Exception("Gallery refused the file");
                    try (InputStream in = new FileInputStream(src); OutputStream os = cr.openOutputStream(out)) {
                        if (os == null) throw new Exception("Cannot write to the Gallery");
                        copy(in, os);
                    }
                    v.clear();
                    v.put(MediaStore.MediaColumns.IS_PENDING, 0);
                    cr.update(out, v, null, null);
                } else {
                    File dir = new File(getContext().getExternalFilesDir(video ? Environment.DIRECTORY_MOVIES : Environment.DIRECTORY_PICTURES), "RC-Rovers");
                    if (!dir.exists() && !dir.mkdirs()) throw new Exception("Cannot create folder");
                    File dst = new File(dir, name);
                    try (InputStream in = new FileInputStream(src); OutputStream os = new FileOutputStream(dst)) { copy(in, os); }
                    MediaScannerConnection.scanFile(getContext(), new String[] { dst.getAbsolutePath() }, new String[] { mime }, null);
                    out = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", dst);
                }
                //noinspection ResultOfMethodCallIgnored
                src.delete();
                JSObject r = new JSObject();
                r.put("uri", out.toString());
                r.put("album", (video ? "Movies" : "Pictures") + "/RC-Rovers");
                call.resolve(r);
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "Could not save" : e.getMessage());
            }
        }).start();
    }

    /** Opens a saved photo or clip in the Gallery / video player. */
    @PluginMethod
    public void open(PluginCall call) {
        String uri = call.getString("uri");
        String mime = call.getString("mime", "image/*");
        if (uri == null) { call.reject("uri is required"); return; }
        try {
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(Uri.parse(uri), mime);
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("No app can open this file");
        }
    }

    private static void copy(InputStream in, OutputStream out) throws Exception {
        byte[] buf = new byte[64 * 1024];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        out.flush();
    }
}
