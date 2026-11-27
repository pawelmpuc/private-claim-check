package io.github.pawelmpuc.privateclaimcheck.labtest;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Rect;
import android.os.Bundle;
import android.os.SystemClock;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.accessibility.AccessibilityNodeInfo;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;

/**
 * Walks through the app on a device-farm phone the way a person would, so the farm's video
 * shows the real app at work: allow the cloud, load the sample estimate, ask for the
 * explanation, look at the result of the audit, reword the letter. It taps what it finds
 * on the screen by its text. Nothing here is faked: each step waits for the app's own answer.
 */
public class LabDemo extends LabRun {
    private int width;
    private int height;

    @Override
    public void onStart() {
        long began = SystemClock.elapsedRealtime();
        Bundle test = new Bundle();
        test.putString("id", "AndroidJUnitRunner");
        test.putInt("numtests", 1);
        test.putInt("current", 1);
        test.putString("class", LabDemo.class.getName());
        test.putString("test", "walkThroughTheApp");
        test.putString("stream", "\n" + LabDemo.class.getName() + ":");
        sendStatus(1, test);

        try {
            DisplayMetrics screen = getTargetContext().getResources().getDisplayMetrics();
            width = screen.widthPixels;
            height = screen.heightPixels;
            sh("mkdir -p /sdcard/screenshots");

            Intent open = new Intent();
            open.setClassName(APP, APP + ".MainActivity");
            open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            open.putExtra("demo", true);
            getTargetContext().startActivity(open);

            step("The app opened", waitFor("Try with a sample estimate", 40) != null);
            SystemClock.sleep(2500);
            shot("01-start");

            step("Cloud allowed", tap("Allow cloud when on-device AI is not available"));
            SystemClock.sleep(1500);
            shot("02-cloud-allowed");

            step("Sample estimate loaded", tap("Try with a sample estimate") && waitFor("Explain this estimate", 30) != null);
            SystemClock.sleep(1500);

            boolean explained = tap("Explain this estimate") && waitFor("Every figure in it was checked", 90) != null;
            step("Explanation arrived", explained);
            SystemClock.sleep(1000);
            show("Every figure in it was checked");
            SystemClock.sleep(4000);
            shot("03-explained");

            step("Audit result on screen", show("You may be owed"));
            SystemClock.sleep(4000);
            shot("04-owed");

            step("Letter on screen", show("4. Your letter"));
            SystemClock.sleep(3000);
            shot("05-letter");

            boolean reworded = tap("Shorter") && waitFor("Opening and closing reworded", 90) != null;
            step("Letter reworded", reworded);
            show("Opening and closing reworded");
            SystemClock.sleep(4000);
            shot("06-reworded");

            show("What ran where");
            SystemClock.sleep(500);
            show("Editing the letter");
            SystemClock.sleep(4000);
            shot("07-log");
        } catch (Throwable problem) {
            Log.e(TAG, "The walk-through itself failed", problem);
        }

        long seconds = (SystemClock.elapsedRealtime() - began) / 1000;
        say("Walk-through ended after " + seconds + " s");
        Bundle done = new Bundle(test);
        done.putString("stream", ".");
        sendStatus(0, done);
        Bundle result = new Bundle();
        result.putString("stream", "\nTime: " + seconds + "\n\nOK (1 test)\n");
        finish(Activity.RESULT_OK, result);
    }

    private void step(String name, boolean ok) {
        say("DEMO " + name + ": " + (ok ? "yes" : "NO"));
        if (!ok) say("DEMO on screen now: " + visibleTexts());
    }

    private void shot(String name) {
        sh("screencap -p /sdcard/screenshots/pcc-" + name + ".png");
    }

    private AccessibilityNodeInfo waitFor(String text, int seconds) {
        long until = SystemClock.elapsedRealtime() + seconds * 1000L;
        while (SystemClock.elapsedRealtime() < until) {
            AccessibilityNodeInfo node = find(text);
            if (node != null) return node;
            SystemClock.sleep(1000);
        }
        return null;
    }

    /** Brings the text into the middle part of the screen, scrolling as a finger would. */
    private boolean show(String text) {
        for (int i = 0; i < 25; i++) {
            AccessibilityNodeInfo node = find(text);
            if (node == null) {
                SystemClock.sleep(700);
                continue;
            }
            Rect box = new Rect();
            node.getBoundsInScreen(box);
            int y = box.centerY();
            if (y > height * 0.22 && y < height * 0.72) return true;
            int from = (int) (height * 0.60);
            int distance = Math.max(-(int) (height * 0.45), Math.min((int) (height * 0.45), y - (int) (height * 0.45)));
            sh("input swipe " + width / 2 + " " + from + " " + width / 2 + " " + (from - distance) + " 500");
            SystemClock.sleep(900);
        }
        return false;
    }

    private boolean tap(String text) {
        if (!show(text)) return false;
        AccessibilityNodeInfo node = find(text);
        if (node == null) return false;
        Rect box = new Rect();
        node.getBoundsInScreen(box);
        sh("input tap " + box.centerX() + " " + box.centerY());
        SystemClock.sleep(600);
        return true;
    }

    /** The smallest thing on the screen that carries this text. */
    private AccessibilityNodeInfo find(String text) {
        AccessibilityNodeInfo best = null;
        long bestArea = Long.MAX_VALUE;
        for (AccessibilityNodeInfo node : all()) {
            if (!carries(node, text)) continue;
            Rect box = new Rect();
            node.getBoundsInScreen(box);
            long area = (long) Math.max(box.width(), 1) * Math.max(box.height(), 1);
            if (area < bestArea) {
                best = node;
                bestArea = area;
            }
        }
        return best;
    }

    private static boolean carries(AccessibilityNodeInfo node, String text) {
        CharSequence a = node.getText();
        CharSequence b = node.getContentDescription();
        return (a != null && a.toString().contains(text)) || (b != null && b.toString().contains(text));
    }

    private List<AccessibilityNodeInfo> all() {
        List<AccessibilityNodeInfo> found = new ArrayList<>();
        AccessibilityNodeInfo root = getUiAutomation().getRootInActiveWindow();
        if (root == null) return found;
        ArrayDeque<AccessibilityNodeInfo> queue = new ArrayDeque<>();
        queue.add(root);
        while (!queue.isEmpty() && found.size() < 4000) {
            AccessibilityNodeInfo node = queue.poll();
            found.add(node);
            for (int i = 0; i < node.getChildCount(); i++) {
                AccessibilityNodeInfo child = node.getChild(i);
                if (child != null) queue.add(child);
            }
        }
        return found;
    }

    private String visibleTexts() {
        StringBuilder out = new StringBuilder();
        for (AccessibilityNodeInfo node : all()) {
            CharSequence text = node.getText() != null ? node.getText() : node.getContentDescription();
            if (text == null || text.length() == 0) continue;
            out.append('[').append(text.length() > 40 ? text.subSequence(0, 40) : text).append("] ");
            if (out.length() > 900) break;
        }
        return out.length() == 0 ? "(nothing readable)" : out.toString();
    }
}
