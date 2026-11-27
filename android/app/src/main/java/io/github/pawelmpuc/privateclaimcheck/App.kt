package io.github.pawelmpuc.privateclaimcheck

import android.app.Application
import android.util.Log
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.appcheck.FirebaseAppCheck
import com.google.firebase.appcheck.debug.DebugAppCheckProviderFactory

class App : Application() {
    override fun onCreate() {
        super.onCreate()
        if (BuildConfig.FIREBASE_APP_ID.isBlank()) {
            // Built without firebase.properties: the app still opens, AI requests report "not configured".
            Log.w("PCC", "Firebase is not configured")
            return
        }
        val options = FirebaseOptions.Builder()
            .setApiKey(BuildConfig.FIREBASE_API_KEY)
            .setApplicationId(BuildConfig.FIREBASE_APP_ID)
            .setProjectId(BuildConfig.FIREBASE_PROJECT_ID)
            .build()
        val app = FirebaseApp.initializeApp(this, options)
        // The hackathon rules accept App Check debug tokens. A store release would use Play Integrity.
        if (BuildConfig.APPCHECK_DEBUG_TOKEN.isNotBlank()) {
            // A token registered in the Firebase console was built in: hand it to the debug provider
            // (this is where the provider keeps its token), so this build works on any phone.
            getSharedPreferences("com.google.firebase.appcheck.debug.store.${app.persistenceKey}", MODE_PRIVATE)
                .edit().putString("com.google.firebase.appcheck.debug.DEBUG_SECRET", BuildConfig.APPCHECK_DEBUG_TOKEN).commit()
        }
        FirebaseAppCheck.getInstance().installAppCheckProviderFactory(DebugAppCheckProviderFactory.getInstance())
        configured = true
    }

    companion object {
        @Volatile var configured = false
    }
}
