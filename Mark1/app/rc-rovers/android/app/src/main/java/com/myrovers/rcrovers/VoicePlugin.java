package com.myrovers.rcrovers;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;

/**
 * Speech recognition for Nova that works on the rover's Wi-Fi (no internet):
 * it prefers Android's on-device recognizer (Android 12+), asks the regular one to
 * stay offline, and falls back between them when a language pack is missing.
 * Events: "partial" {text} · "final" {text, alts} · "error" {code, message} ·
 * "state" {listening, onDevice} · "level" {rms}.
 */
@CapacitorPlugin(name = "Voice", permissions = { @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = "mic") })
public class VoicePlugin extends Plugin {

    private static final int ERROR_LANGUAGE_NOT_SUPPORTED = 12;
    private static final int ERROR_LANGUAGE_UNAVAILABLE = 13;

    private SpeechRecognizer rec;
    private boolean onDevice;
    private boolean fellBack;
    private String lang = "en-US";
    private long lastLevel;

    private boolean deviceAvailable() {
        return Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(getContext());
    }

    @PluginMethod
    public void available(PluginCall call) {
        JSObject r = new JSObject();
        boolean std = SpeechRecognizer.isRecognitionAvailable(getContext());
        boolean dev = deviceAvailable();
        r.put("available", std || dev);
        r.put("onDevice", dev);
        call.resolve(r);
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (getPermissionState("mic") != PermissionState.GRANTED) {
            requestPermissionForAlias("mic", call, "micPermission");
            return;
        }
        begin(call);
    }

    @PermissionCallback
    private void micPermission(PluginCall call) {
        if (getPermissionState("mic") == PermissionState.GRANTED) begin(call);
        else call.reject("Microphone permission denied", "denied");
    }

    private void begin(PluginCall call) {
        lang = call.getString("lang", "en-US");
        fellBack = false;
        getActivity().runOnUiThread(() -> {
            try {
                listen(deviceAvailable());
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "Could not start voice" : e.getMessage());
            }
        });
    }

    private void listen(boolean useDevice) {
        destroy();
        onDevice = useDevice;
        rec = useDevice && Build.VERSION.SDK_INT >= 31
            ? SpeechRecognizer.createOnDeviceSpeechRecognizer(getContext())
            : SpeechRecognizer.createSpeechRecognizer(getContext());
        rec.setRecognitionListener(new Listener());
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, lang);
        i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);
        i.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
        i.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getContext().getPackageName());
        i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 1100L);
        i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 900L);
        rec.startListening(i);
        JSObject s = new JSObject();
        s.put("listening", true);
        s.put("onDevice", useDevice);
        notifyListeners("state", s);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getActivity().runOnUiThread(() -> { if (rec != null) rec.stopListening(); });
        call.resolve();
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        getActivity().runOnUiThread(this::destroy);
        call.resolve();
    }

    private void destroy() {
        if (rec != null) {
            try { rec.cancel(); rec.destroy(); } catch (Exception ignored) { }
            rec = null;
        }
    }

    @Override
    protected void handleOnDestroy() {
        destroy();
    }

    private static String first(Bundle b) {
        ArrayList<String> m = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        return m != null && !m.isEmpty() && m.get(0) != null ? m.get(0) : "";
    }

    private class Listener implements RecognitionListener {
        @Override public void onReadyForSpeech(Bundle params) { }
        @Override public void onBeginningOfSpeech() { }
        @Override public void onBufferReceived(byte[] buffer) { }
        @Override public void onEvent(int eventType, Bundle params) { }

        @Override
        public void onRmsChanged(float rmsdB) {
            long now = System.currentTimeMillis();
            if (now - lastLevel < 90) return;
            lastLevel = now;
            JSObject o = new JSObject();
            o.put("rms", rmsdB);
            notifyListeners("level", o);
        }

        @Override
        public void onEndOfSpeech() {
            JSObject s = new JSObject();
            s.put("listening", false);
            s.put("onDevice", onDevice);
            notifyListeners("state", s);
        }

        @Override
        public void onPartialResults(Bundle b) {
            String t = first(b);
            if (t.isEmpty()) return;
            JSObject o = new JSObject();
            o.put("text", t);
            notifyListeners("partial", o);
        }

        @Override
        public void onResults(Bundle b) {
            ArrayList<String> m = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            JSObject o = new JSObject();
            o.put("text", first(b));
            o.put("alts", new JSArray(m == null ? new ArrayList<String>() : m));
            notifyListeners("final", o);
            destroy();
        }

        @Override
        public void onError(int code) {
            // On-device pack missing for this language → try the regular recognizer once.
            if (onDevice && !fellBack && (code == ERROR_LANGUAGE_NOT_SUPPORTED || code == ERROR_LANGUAGE_UNAVAILABLE
                    || code == SpeechRecognizer.ERROR_CLIENT || code == SpeechRecognizer.ERROR_SERVER)) {
                fellBack = true;
                getActivity().runOnUiThread(() -> {
                    try { listen(false); } catch (Exception e) { emitError(SpeechRecognizer.ERROR_CLIENT); }
                });
                return;
            }
            emitError(code);
            destroy();
        }
    }

    private void emitError(int code) {
        JSObject o = new JSObject();
        o.put("code", code);
        o.put("onDevice", onDevice);
        notifyListeners("error", o);
    }
}
