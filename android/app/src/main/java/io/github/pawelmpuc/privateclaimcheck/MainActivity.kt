package io.github.pawelmpuc.privateclaimcheck

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.util.Log
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.webkit.WebViewAssetLoader

/** Shows the same app as the web version, from files packed into the APK, and gives it the native AI bridge. */
class MainActivity : ComponentActivity() {
    private lateinit var webView: WebView
    private lateinit var bridge: AiBridge
    private var fileCallback: ValueCallback<Array<Uri>>? = null

    private val pickFiles = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
        fileCallback = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val assets = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
        webView = WebView(this)
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.allowFileAccess = false
        webView.settings.allowContentAccess = false
        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                assets.shouldInterceptRequest(request.url)

            // Links in the app (licence, source) open in the browser, not inside the app.
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.host == WebViewAssetLoader.DEFAULT_DOMAIN) return false
                startActivity(Intent(Intent.ACTION_VIEW, request.url))
                return true
            }
        }
        webView.webChromeClient = object : WebChromeClient() {
            // The page's console goes to logcat, so a run on a device farm leaves a readable record.
            override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                Log.i("PCC", message.message())
                return true
            }

            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                return try {
                    pickFiles.launch(params.createIntent())
                    true
                } catch (e: Exception) {
                    fileCallback = null
                    false
                }
            }
        }
        bridge = AiBridge(webView) { webView.postDelayed({ finish() }, 20_000) }
        // The bridge is only exposed to the pages packed into the APK: nothing else is ever loaded in this WebView.
        webView.addJavascriptInterface(bridge, "PccNative")
        setContentView(webView)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        })
        if (savedInstanceState == null) {
            // In Firebase Test Lab nobody taps the screen: open the hands-free on-device self-test.
            val inTestLab = Settings.System.getString(contentResolver, "firebase.test.lab") == "true"
            val selfTest = inTestLab || intent.action == "com.google.intent.action.TEST_LOOP" || intent.getBooleanExtra("selftest", false)
            if (selfTest) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            // "selftestWait": how many seconds the self-test keeps asking a freshly reset phone for its model.
            val wait = intent.getIntExtra("selftestWait", 0)
            // "selftestCloud": also send the built-in sample estimate (no real document) to the cloud model.
            val cloud = intent.getBooleanExtra("selftestCloud", false)
            val query = if (selfTest) "?selftest" + (if (wait > 0) "&wait=$wait" else "") + (if (cloud) "&cloud=1" else "") else ""
            webView.loadUrl("https://${WebViewAssetLoader.DEFAULT_DOMAIN}/assets/www/index.html$query")
        } else {
            webView.restoreState(savedInstanceState)
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onDestroy() {
        bridge.close()
        webView.destroy()
        super.onDestroy()
    }
}
