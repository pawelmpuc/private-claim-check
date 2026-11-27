package io.github.pawelmpuc.privateclaimcheck

import android.content.Context
import android.graphics.BitmapFactory
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.WebView
import com.google.firebase.Firebase
import com.google.firebase.FirebaseApp
import com.google.firebase.ai.InferenceMode
import com.google.firebase.ai.InferenceSource
import com.google.firebase.ai.OnDeviceConfig
import com.google.firebase.ai.ai
import com.google.firebase.ai.ondevice.DownloadStatus
import com.google.firebase.ai.ondevice.FirebaseAIOnDevice
import com.google.firebase.ai.ondevice.OnDeviceModelStatus
import com.google.firebase.ai.type.content
import com.google.firebase.ai.type.GenerativeBackend
import com.google.firebase.ai.type.PublicPreviewAPI
import com.google.firebase.ai.type.generationConfig
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap

/**
 * The web app's only door to a model on Android. Every request goes through the
 * Firebase AI Logic Android SDK. The page says where a request may run
 * ("device" or "cloud"); this class never changes that choice on its own, so the
 * page's consent and redaction rules hold here exactly as they do in Chrome.
 */
@OptIn(PublicPreviewAPI::class)
class AiBridge(private val webView: WebView, private val onSelfTestDone: () -> Unit) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val running = ConcurrentHashMap<String, Job>()

    fun close() = scope.cancel()

    @JavascriptInterface
    fun post(message: String) {
        val msg = JSONObject(message)
        val id = msg.getString("id")
        when (msg.optString("op")) {
            "cancel" -> running.remove(id)?.cancel()
            // The hands-free self-test is over: the activity closes a little later, which ends a Test Lab run.
            "selfTestDone" -> webView.post { onSelfTestDone() }
            else -> running[id] = scope.launch {
                try {
                    if (!App.configured) throw IllegalStateException("not_configured")
                    when (msg.getString("op")) {
                        "status" -> {
                            val state = status()
                            reply(id) { put("ok", true); put("status", state) }
                        }
                        "download" -> download(id)
                        "debugToken" -> {
                            val token = debugToken()
                            reply(id) { put("ok", true); put("text", token) }
                        }
                        "generate" -> generate(id, msg)
                        else -> throw IllegalArgumentException("unknown op")
                    }
                } catch (e: Throwable) {
                    reply(id) { put("ok", false); put("error", e.message ?: e.javaClass.simpleName) }
                } finally {
                    running.remove(id)
                }
            }
        }
    }

    private suspend fun status(): String = when (FirebaseAIOnDevice.checkStatus()) {
        OnDeviceModelStatus.AVAILABLE -> "available"
        OnDeviceModelStatus.DOWNLOADABLE -> "downloadable"
        OnDeviceModelStatus.DOWNLOADING -> "downloading"
        else -> "unavailable"
    }

    /**
     * Debug builds only: the App Check debug secret this installation generated, so the
     * developer can register it in the Firebase console without reading logcat.
     */
    private fun debugToken(): String {
        if (!BuildConfig.DEBUG) return ""
        val key = FirebaseApp.getInstance().persistenceKey
        return webView.context.getSharedPreferences("com.google.firebase.appcheck.debug.store.$key", Context.MODE_PRIVATE)
            .getString("com.google.firebase.appcheck.debug.DEBUG_SECRET", "") ?: ""
    }

    private suspend fun download(id: String) {
        var total = 0L
        var failure: String? = null
        FirebaseAIOnDevice.download().collect { step ->
            when (step) {
                is DownloadStatus.DownloadStarted -> total = step.bytesToDownload
                is DownloadStatus.DownloadInProgress ->
                    if (total > 0) reply(id) { put("progress", step.totalBytesDownloaded.toDouble() / total) }
                is DownloadStatus.DownloadFailed -> failure = "The on-device model could not be downloaded."
                else -> Unit
            }
        }
        failure?.let { throw IllegalStateException(it) }
        reply(id) { put("ok", true) }
    }

    private suspend fun generate(id: String, msg: JSONObject) {
        val onDevice = msg.getString("mode") == "device"
        val parts = msg.getJSONArray("parts")
        val content = content {
            for (i in 0 until parts.length()) {
                val part = parts.getJSONObject(i)
                if (part.has("text")) {
                    text(part.getString("text"))
                } else {
                    val bytes = Base64.decode(part.getString("data"), Base64.DEFAULT)
                    // The on-device model takes a Bitmap; the cloud model takes one just as well.
                    image(BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: throw IllegalArgumentException("unreadable image"))
                }
            }
        }
        val model = Firebase.ai(backend = GenerativeBackend.googleAI()).generativeModel(
            modelName = msg.getString("model"),
            generationConfig = generationConfig {
                if (msg.optBoolean("json")) {
                    responseMimeType = "application/json"
                    temperature = 0f
                } else {
                    temperature = 0.3f
                }
            },
            onDeviceConfig = OnDeviceConfig(mode = if (onDevice) InferenceMode.ONLY_ON_DEVICE else InferenceMode.ONLY_IN_CLOUD),
        )
        val text = StringBuilder()
        var source: InferenceSource? = null
        model.generateContentStream(content).collect { chunk ->
            source = chunk.inferenceSource
            chunk.text?.let {
                text.append(it)
                reply(id) { put("chunk", it) }
            }
        }
        reply(id) {
            put("ok", true)
            put("text", text.toString())
            // Reported by the SDK. If it says nothing, the mode that was asked for is the only place it can have run.
            put("source", if (source == InferenceSource.ON_DEVICE || (source == null && onDevice)) "on_device" else "in_cloud")
        }
    }

    private fun reply(id: String, fill: JSONObject.() -> Unit) {
        val json = JSONObject().put("id", id).apply(fill).toString()
        webView.post { webView.evaluateJavascript("window.__pccNativeReply && window.__pccNativeReply(${JSONObject.quote(json)})", null) }
    }
}
