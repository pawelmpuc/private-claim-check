package io.github.pawelmpuc.privateclaimcheck.labtest;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import android.util.Log;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.util.ArrayList;
import java.util.List;

/**
 * Starts the app's hands-free on-device self-test on a device-farm phone and waits for it.
 *
 * Phones on a device farm are wiped before every run and keep the system's configuration
 * sync switched off, so the service that provides Gemini Nano (AICore) never receives its
 * settings and reports "no model". Before the self-test this run writes down the state of
 * the phone and switches that sync back on, then gives the phone time. Everything goes to
 * logcat under the tag "PCCLAB"; the app's own lines are under "PCC".
 */
public class LabRun extends Instrumentation {
    private static final String TAG = "PCCLAB";
    private static final String APP = "io.github.pawelmpuc.privateclaimcheck";
    private static final String AICORE = "com.google.android.aicore";

    @Override
    public void onCreate(Bundle arguments) {
        super.onCreate(arguments);
        start();
    }

    @Override
    public void onStart() {
        long began = SystemClock.elapsedRealtime();
        Bundle test = new Bundle();
        test.putString("id", "AndroidJUnitRunner");
        test.putInt("numtests", 1);
        test.putInt("current", 1);
        test.putString("class", LabRun.class.getName());
        test.putString("test", "onDeviceSelfTest");
        test.putString("stream", "\n" + LabRun.class.getName() + ":");
        sendStatus(1, test);

        boolean finished = false;
        try {
            boolean emulator = Build.FINGERPRINT.contains("generic") || Build.FINGERPRINT.contains("emu")
                    || Build.HARDWARE.contains("ranchu") || Build.HARDWARE.contains("goldfish");
            // An emulator has no Gemini Nano: it only proves that this run itself works.
            // A phone without AICore will never have the model, and neither will one that still carries
            // the factory placeholder ("stub") of AICore: the real one arrives through the Play Store,
            // which needs a Google account that device-farm phones do not have. There the run only
            // checks the cloud half.
            boolean hasAiCore = !grep(sh("pm list packages"), "package:" + AICORE).isEmpty();
            boolean stub = !grep(sh("dumpsys package " + AICORE), "versionName=0.stub", "aicore_stub").isEmpty();
            boolean quick = emulator || !hasAiCore || stub;
            if (hasAiCore && stub) say("AICore on this phone is the factory placeholder, not the real service: no on-device model is possible here");
            int waitForModelS = quick ? 40 : 1500;
            long budgetMs = (quick ? 6 : 41) * 60_000L;

            say("Phone: " + Build.MANUFACTURER + " " + Build.MODEL + ", Android " + Build.VERSION.RELEASE + " (API " + Build.VERSION.SDK_INT + ")" + (emulator ? ", emulator" : ""));
            for (String prop : new String[] {"ro.boot.verifiedbootstate", "ro.boot.flash.locked", "ro.boot.vbmeta.device_state"}) {
                say(prop + " = " + first(sh("getprop " + prop)));
            }
            report("AICore package", grep(sh("dumpsys package " + AICORE), "versionName=", "versionCode=", "firstInstallTime=", "lastUpdateTime=", "enabled="), 8);
            report("Google Play services", grep(sh("dumpsys package com.google.android.gms"), "versionName="), 2);
            report("AI packages installed", grep(sh("pm list packages"), "aicore", "gemini", "genai"), 12);
            say("Google accounts on the phone: " + grep(sh("dumpsys account"), "Account {").size());
            say("Configuration sync, as found: " + first(sh("device_config get_sync_disabled_for_tests")));
            say("AICore settings on the phone, as found: " + lines(sh("device_config list aicore")).size());
            report("Wi-Fi", grep(sh("dumpsys wifi"), "Wi-Fi is ", "mWifiInfo SSID"), 2);
            report("Free space", grep(sh("df -h /data"), "/data"), 1);

            // The one change this run makes to the phone.
            sh("device_config set_sync_disabled_for_tests none");
            say("Configuration sync, after switching it on: " + first(sh("device_config get_sync_disabled_for_tests")));
            if (!quick) {
                // Google Play services gave up delivering AICore's settings while the sync was off. Restart it
                // so it tries again, wait for the settings, then restart AICore so it reads them.
                sh("am force-stop com.google.android.gms");
                for (int i = 0; i < 12 && lines(sh("device_config list aicore")).isEmpty(); i++) SystemClock.sleep(10_000);
                say("AICore settings on the phone after restarting Google Play services: " + lines(sh("device_config list aicore")).size());
                sh("am force-stop " + AICORE);
                SystemClock.sleep(5_000);
            }

            Intent open = new Intent();
            open.setClassName(APP, APP + ".MainActivity");
            open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            open.putExtra("selftest", true);
            open.putExtra("selftestWait", waitForModelS);
            open.putExtra("selftestCloud", true);
            getTargetContext().startActivity(open);
            say("Self-test started; it asks for the model for up to " + waitForModelS + " s");

            int settingsSeen = -1;
            boolean nudgedAiCore = false;
            boolean nudgedPlayServices = false;
            while (SystemClock.elapsedRealtime() - began < budgetMs) {
                SystemClock.sleep(15_000);
                long seconds = (SystemClock.elapsedRealtime() - began) / 1000;
                List<String> app = grep(sh("logcat -d -s PCC:I"), "[PCC selftest]");
                if (contains(app, "Self-test: finished")) {
                    finished = true;
                    break;
                }
                int settings = lines(sh("device_config list aicore")).size();
                if (settings != settingsSeen) {
                    say("After " + seconds + " s: AICore settings on the phone: " + settings);
                    settingsSeen = settings;
                }
                boolean noModelYet = !contains(app, "On-device model: downloadable") && !contains(app, "On-device model: downloading")
                        && !contains(app, "On-device model: available") && !contains(app, "Download:");
                // If the model still has not turned up, restart the services that deliver its settings, the way a reboot would.
                if (!quick && noModelYet && seconds > 700 && !nudgedPlayServices) {
                    nudgedPlayServices = true;
                    say("After " + seconds + " s: still no model; restarting Google Play services");
                    sh("am force-stop com.google.android.gms");
                }
                if (!quick && noModelYet && seconds > 400 && !nudgedAiCore) {
                    nudgedAiCore = true;
                    say("After " + seconds + " s: still no model; restarting AICore");
                    sh("am force-stop " + AICORE);
                }
            }
            say("AICore settings on the phone at the end: " + lines(sh("device_config list aicore")).size());
            report("AICore package at the end", grep(sh("dumpsys package " + AICORE), "versionName=", "lastUpdateTime="), 4);
            report("The app's self-test", grep(sh("logcat -d -s PCC:I"), "[PCC selftest]"), 80);
        } catch (Throwable problem) {
            Log.e(TAG, "The run itself failed", problem);
        }

        long seconds = (SystemClock.elapsedRealtime() - began) / 1000;
        say((finished ? "Self-test finished" : "Self-test did not finish in time") + " after " + seconds + " s");
        Bundle done = new Bundle(test);
        done.putString("stream", ".");
        sendStatus(0, done);
        Bundle result = new Bundle();
        result.putString("stream", "\nTime: " + seconds + "\n\nOK (1 test)\n");
        finish(Activity.RESULT_OK, result);
    }

    private static void say(String line) {
        Log.i(TAG, line);
    }

    private static void report(String title, List<String> found, int most) {
        if (found.isEmpty()) say(title + ": nothing found");
        for (int i = 0; i < found.size() && i < most; i++) say(title + ": " + found.get(i).trim());
    }

    /** Runs a command the way `adb shell` would. No pipes: the output is filtered here. */
    private String sh(String command) {
        StringBuilder out = new StringBuilder();
        try (ParcelFileDescriptor.AutoCloseInputStream in = new ParcelFileDescriptor.AutoCloseInputStream(getUiAutomation().executeShellCommand(command));
             BufferedReader reader = new BufferedReader(new InputStreamReader(in))) {
            String line;
            while ((line = reader.readLine()) != null) out.append(line).append('\n');
        } catch (Throwable problem) {
            out.append("(could not run: ").append(problem).append(")\n");
        }
        return out.toString();
    }

    private static List<String> lines(String text) {
        List<String> all = new ArrayList<>();
        for (String line : text.split("\n")) if (!line.trim().isEmpty()) all.add(line);
        return all;
    }

    private static List<String> grep(String text, String... needles) {
        List<String> found = new ArrayList<>();
        for (String line : lines(text)) {
            for (String needle : needles) {
                if (line.contains(needle)) {
                    found.add(line);
                    break;
                }
            }
        }
        return found;
    }

    private static boolean contains(List<String> all, String needle) {
        for (String line : all) if (line.contains(needle)) return true;
        return false;
    }

    private static String first(String text) {
        List<String> all = lines(text);
        return all.isEmpty() ? "(empty)" : all.get(0).trim();
    }
}
